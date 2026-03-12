import { expect } from "chai";
import { ethers } from "hardhat";

describe("ShipmentTracker", function () {
  let shipmentTracker: any;
  let companyRegistry: any;
  let owner: any;
  let addr1: any;
  let addr2: any;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const CompanyRegistry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await CompanyRegistry.deploy();
    await companyRegistry.waitForDeployment();

    const ShipmentTracker = await ethers.getContractFactory("ShipmentTracker");
    shipmentTracker = await ShipmentTracker.deploy();
    await shipmentTracker.waitForDeployment();

    // Grant approved company role
    await shipmentTracker.grantRole(
      ethers.keccak256(ethers.toUtf8Bytes("APPROVED_COMPANY")),
      addr1.address
    );
    await shipmentTracker.grantRole(
      ethers.keccak256(ethers.toUtf8Bytes("APPROVED_COMPANY")),
      addr2.address
    );
  });

  describe("Shipment Creation", function () {
    it("Should create a shipment", async function () {
      const expectedDeliveryDate = Math.floor(Date.now() / 1000) + 86400; // 1 day from now

      const tx = await shipmentTracker.connect(addr1).createShipment(
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        "Port of Seattle",
        "Port of Shanghai",
        addr2.address,
        expectedDeliveryDate,
        "SHIP123456"
      );

      const receipt = await tx.wait();
      const shipmentCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "ShipmentCreated"
      );

      expect(shipmentCreatedEvent).to.not.be.undefined;

      const shipmentId = shipmentCreatedEvent.args.shipmentId;
      const shipment = await shipmentTracker.getShipment(shipmentId);

      expect(shipment.creator).to.equal(addr1.address);
      expect(shipment.commodityType).to.equal("Wheat");
      expect(shipment.quantity).to.equal(ethers.parseEther("100"));
      expect(shipment.origin).to.equal("Port of Seattle");
      expect(shipment.destination).to.equal("Port of Shanghai");
      expect(shipment.shipper).to.equal(addr2.address);
      expect(shipment.trackingId).to.equal("SHIP123456");
      expect(shipment.status).to.equal(0); // CREATED
    });

    it("Should track shipment status updates", async function () {
      const expectedDeliveryDate = Math.floor(Date.now() / 1000) + 86400;

      const tx = await shipmentTracker.connect(addr1).createShipment(
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        "Port of Seattle",
        "Port of Shanghai",
        addr2.address,
        expectedDeliveryDate,
        "SHIP123456"
      );

      const receipt = await tx.wait();
      const shipmentCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "ShipmentCreated"
      );
      const shipmentId = shipmentCreatedEvent.args.shipmentId;

      // Update status
      await shipmentTracker.connect(addr1).updateShipmentStatus(
        shipmentId,
        1, // PICKED_UP
        "Container loaded at port"
      );

      const updates = await shipmentTracker.getStatusUpdates(shipmentId);
      expect(updates.length).to.equal(2); // Initial + update
      expect(updates[1].status).to.equal(1); // PICKED_UP
      expect(updates[1].details).to.equal("Container loaded at port");
    });

    it("Should add checkpoints", async function () {
      const expectedDeliveryDate = Math.floor(Date.now() / 1000) + 86400;

      const tx = await shipmentTracker.connect(addr1).createShipment(
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        "Port of Seattle",
        "Port of Shanghai",
        addr2.address,
        expectedDeliveryDate,
        "SHIP123456"
      );

      const receipt = await tx.wait();
      const shipmentCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "ShipmentCreated"
      );
      const shipmentId = shipmentCreatedEvent.args.shipmentId;

      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("checkpoint_data"));

      await shipmentTracker.connect(addr1).addShipmentCheckpoint(
        shipmentId,
        "Pacific Ocean",
        15, // temperature
        60, // humidity
        dataHash
      );

      const checkpoints = await shipmentTracker.getCheckpoints(shipmentId);
      expect(checkpoints.length).to.equal(1);
      expect(checkpoints[0].location).to.equal("Pacific Ocean");
      expect(checkpoints[0].temperature).to.equal(15);
      expect(checkpoints[0].humidity).to.equal(60);
      expect(checkpoints[0].dataHash).to.equal(dataHash);
    });
  });

  describe("Shipment Status Transitions", function () {
    let shipmentId: any;

    beforeEach(async function () {
      const expectedDeliveryDate = Math.floor(Date.now() / 1000) + 86400;

      const tx = await shipmentTracker.connect(addr1).createShipment(
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        "Port of Seattle",
        "Port of Shanghai",
        addr2.address,
        expectedDeliveryDate,
        "SHIP123456"
      );

      const receipt = await tx.wait();
      const shipmentCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "ShipmentCreated"
      );
      shipmentId = shipmentCreatedEvent.args.shipmentId;
    });

    it("Should follow valid status transitions", async function () {
      // Created -> Picked Up
      await shipmentTracker.connect(addr1).updateShipmentStatus(
        shipmentId,
        1, // PICKED_UP
        "Loaded"
      );

      // Picked Up -> In Transit
      await shipmentTracker.connect(addr1).updateShipmentStatus(
        shipmentId,
        2, // IN_TRANSIT
        "Departed port"
      );

      // In Transit -> Customs
      await shipmentTracker.connect(addr1).updateShipmentStatus(
        shipmentId,
        3, // CUSTOMS
        "Arrived at destination port"
      );

      // Customs -> Delivered
      await shipmentTracker.connect(addr1).updateShipmentStatus(
        shipmentId,
        4, // DELIVERED
        "Delivered to customer"
      );

      const shipment = await shipmentTracker.getShipment(shipmentId);
      expect(shipment.status).to.equal(4); // DELIVERED
    });

    it("Should reject invalid status transitions", async function () {
      // Try to go directly from CREATED to DELIVERED (invalid)
      await expect(
        shipmentTracker.connect(addr1).updateShipmentStatus(
          shipmentId,
          4, // DELIVERED
          "Delivered"
        )
      ).to.be.reverted; // Should fail due to invalid transition
    });
  });
});