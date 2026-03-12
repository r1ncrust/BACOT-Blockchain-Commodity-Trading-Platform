// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IShipmentTracker {
    enum ShipmentStatus { 
        CREATED, 
        PICKED_UP, 
        IN_TRANSIT, 
        CUSTOMS, 
        DELIVERED, 
        DISPUTED, 
        CANCELLED 
    }

    struct Shipment {
        uint256 id;
        address creator;
        string commodityType;
        uint256 quantity;
        string unit;
        string origin;
        string destination;
        address shipper;
        uint256 expectedDeliveryDate;
        string trackingId;
        ShipmentStatus status;
        uint256 createdAt;
    }

    struct StatusUpdate {
        ShipmentStatus status;
        string details;
        uint256 timestamp;
        address updater;
    }

    struct Checkpoint {
        string location;
        int256 temperature;
        int256 humidity;
        uint256 timestamp;
        bytes32 dataHash;
    }

    event ShipmentCreated(uint256 indexed shipmentId, address indexed creator);
    event ShipmentStatusUpdated(uint256 indexed shipmentId, ShipmentStatus newStatus, string details);
    event ShipmentCheckpointAdded(uint256 indexed shipmentId, string location, bytes32 dataHash);
    event ShipmentDisputed(uint256 indexed shipmentId);
    event ShipmentCancelled(uint256 indexed shipmentId);

    function createShipment(
        string memory _commodityType,
        uint256 _quantity,
        string memory _unit,
        string memory _origin,
        string memory _destination,
        address _shipper,
        uint256 _expectedDeliveryDate,
        string memory _trackingId
    ) external returns (uint256);

    function updateShipmentStatus(
        uint256 _shipmentId,
        ShipmentStatus _newStatus,
        string memory _details
    ) external;

    function addShipmentCheckpoint(
        uint256 _shipmentId,
        string memory _location,
        int256 _temperature,
        int256 _humidity,
        bytes32 _dataHash
    ) external;

    function disputeShipment(uint256 _shipmentId) external;
    function cancelShipment(uint256 _shipmentId) external;
    function getShipment(uint256 _shipmentId) external view returns (Shipment memory);
    function getStatusUpdates(uint256 _shipmentId) external view returns (StatusUpdate[] memory);
    function getCheckpoints(uint256 _shipmentId) external view returns (Checkpoint[] memory);
}