// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/IShipmentTracker.sol";
import "@openzeppelin/contracts/utils/Strings.sol";


contract ShipmentTracker is IShipmentTracker, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    mapping(uint256 => Shipment) private shipments;
    mapping(uint256 => StatusUpdate[]) private statusUpdates;
    mapping(uint256 => Checkpoint[]) private checkpoints;
    uint256 private nextShipmentId = 1;

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Not admin");
        _;
    }

    modifier onlyApprovedCompany() {
        require(hasRole(keccak256("APPROVED_COMPANY"), msg.sender), "Not approved company");
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(REVIEWER_ROLE, msg.sender);
    }

    function createShipment(
        string memory _commodityType,
        uint256 _quantity,
        string memory _unit,
        string memory _origin,
        string memory _destination,
        address _shipper,
        uint256 _expectedDeliveryDate,
        string memory _trackingId
    ) external onlyApprovedCompany returns (uint256) {
        require(bytes(_commodityType).length > 0, "Commodity type required");
        require(_quantity > 0, "Quantity must be positive");
        require(bytes(_unit).length > 0, "Unit required");
        require(bytes(_origin).length > 0, "Origin required");
        require(bytes(_destination).length > 0, "Destination required");
        require(_expectedDeliveryDate > block.timestamp, "Invalid delivery date");

        uint256 shipmentId = nextShipmentId++;
        shipments[shipmentId] = Shipment({
            id: shipmentId,
            creator: msg.sender,
            commodityType: _commodityType,
            quantity: _quantity,
            unit: _unit,
            origin: _origin,
            destination: _destination,
            shipper: _shipper,
            expectedDeliveryDate: _expectedDeliveryDate,
            trackingId: _trackingId,
            status: ShipmentStatus.CREATED,
            createdAt: block.timestamp
        });

        // Add initial status update
        statusUpdates[shipmentId].push(StatusUpdate({
            status: ShipmentStatus.CREATED,
            details: "Shipment created",
            timestamp: block.timestamp,
            updater: msg.sender
        }));

        emit ShipmentCreated(shipmentId, msg.sender);
        return shipmentId;
    }

    function updateShipmentStatus(
        uint256 _shipmentId,
        ShipmentStatus _newStatus,
        string memory _details
    ) external onlyApprovedCompany {
        require(shipments[_shipmentId].id != 0, "Shipment does not exist");
        require(isValidStatusTransition(shipments[_shipmentId].status, _newStatus), "Invalid status transition");
        
        shipments[_shipmentId].status = _newStatus;
        statusUpdates[_shipmentId].push(StatusUpdate({
            status: _newStatus,
            details: _details,
            timestamp: block.timestamp,
            updater: msg.sender
        }));

        emit ShipmentStatusUpdated(_shipmentId, _newStatus, _details);
    }

    function addShipmentCheckpoint(
        uint256 _shipmentId,
        string memory _location,
        int256 _temperature,
        int256 _humidity,
        bytes32 _dataHash
    ) external onlyApprovedCompany {
        require(shipments[_shipmentId].id != 0, "Shipment does not exist");
        require(bytes(_location).length > 0, "Location required");
        
        checkpoints[_shipmentId].push(Checkpoint({
            location: _location,
            temperature: _temperature,
            humidity: _humidity,
            timestamp: block.timestamp,
            dataHash: _dataHash
        }));

        emit ShipmentCheckpointAdded(_shipmentId, _location, _dataHash);
    }

    function disputeShipment(uint256 _shipmentId) external onlyApprovedCompany {
        require(shipments[_shipmentId].id != 0, "Shipment does not exist");
        require(shipments[_shipmentId].status != ShipmentStatus.DISPUTED, "Already disputed");
        require(shipments[_shipmentId].status != ShipmentStatus.CANCELLED, "Shipment cancelled");
        
        shipments[_shipmentId].status = ShipmentStatus.DISPUTED;
        statusUpdates[_shipmentId].push(StatusUpdate({
            status: ShipmentStatus.DISPUTED,
            details: string(abi.encodePacked("Disputed by ", Strings.toHexString(msg.sender))),
            // details: "Disputed by " + Strings.toString(msg.sender),
            timestamp: block.timestamp,
            updater: msg.sender
        }));

        emit ShipmentDisputed(_shipmentId);
    }

    function cancelShipment(uint256 _shipmentId) external onlyApprovedCompany {
        require(shipments[_shipmentId].id != 0, "Shipment does not exist");
        require(shipments[_shipmentId].status != ShipmentStatus.DELIVERED, "Cannot cancel delivered shipment");
        require(shipments[_shipmentId].status != ShipmentStatus.CANCELLED, "Already cancelled");
        
        shipments[_shipmentId].status = ShipmentStatus.CANCELLED;
        statusUpdates[_shipmentId].push(StatusUpdate({
            status: ShipmentStatus.CANCELLED,
            details: string(abi.encodePacked("Cancelled by ", Strings.toHexString(msg.sender))),
            // details: "Cancelled by " + Strings.toString(msg.sender),
            timestamp: block.timestamp,
            updater: msg.sender
        }));

        emit ShipmentCancelled(_shipmentId);
    }

    function getShipment(uint256 _shipmentId) external view returns (Shipment memory) {
        return shipments[_shipmentId];
    }

    function getStatusUpdates(uint256 _shipmentId) external view returns (StatusUpdate[] memory) {
        return statusUpdates[_shipmentId];
    }

    function getCheckpoints(uint256 _shipmentId) external view returns (Checkpoint[] memory) {
        return checkpoints[_shipmentId];
    }

    function isValidStatusTransition(ShipmentStatus current, ShipmentStatus next) internal pure returns (bool) {
        if (current == ShipmentStatus.CREATED) {
            return next == ShipmentStatus.PICKED_UP || next == ShipmentStatus.CANCELLED;
        } else if (current == ShipmentStatus.PICKED_UP) {
            return next == ShipmentStatus.IN_TRANSIT || next == ShipmentStatus.CANCELLED;
        } else if (current == ShipmentStatus.IN_TRANSIT) {
            return next == ShipmentStatus.CUSTOMS || next == ShipmentStatus.CANCELLED;
        } else if (current == ShipmentStatus.CUSTOMS) {
            return next == ShipmentStatus.DELIVERED || next == ShipmentStatus.DISPUTED || next == ShipmentStatus.CANCELLED;
        } else if (current == ShipmentStatus.DELIVERED) {
            return false; // Delivered is terminal
        } else if (current == ShipmentStatus.DISPUTED) {
            return next == ShipmentStatus.CANCELLED; // After dispute resolution
        } else if (current == ShipmentStatus.CANCELLED) {
            return false; // Cancelled is terminal
        }
        return false;
    }
}