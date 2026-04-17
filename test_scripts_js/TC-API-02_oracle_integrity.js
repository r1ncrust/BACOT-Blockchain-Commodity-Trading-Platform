// =============================================================================
// TC-API-02 | Oracle Data Feed Manipulation (Information Disclosure / Integrity)
// Target   : TradeManager.sol – uploadDocument() (document hash integrity)
//            ShipmentTracker.sol – addShipmentCheckpoint() (oracle-like data hash)
//            Off-chain oracle endpoint (manual companion test)
// Threat   : Information Disclosure
// Tool     : Hardhat (on-chain), Manual Test (off-chain)
// Severity : Medium–High (CVSS 6.5–8.0)
//
// Objective:
//   Verify that external data submitted to the blockchain platform (oracle
//   inputs, document hashes, shipment checkpoint data) cannot be:
//     (a) Substituted with a different value without detection.
//     (b) Accepted by the smart contract without integrity verification.
//     (c) Submitted by an unauthorized party.
//
//   ShipmentTracker.addShipmentCheckpoint() stores a dataHash for each
//   checkpoint, which acts as an oracle data commitment.
//   TradeManager.uploadDocument() emits a DocumentUploaded event with hash.
//
// On-chain tests (Hardhat):
//   - Verify checkpoint data hash is stored immutably.
//   - Verify tampered data produces a different hash (detectable).
//   - Verify unauthorized party cannot submit checkpoint data.
//
// Off-chain companion (manual):
//   - Run `node TC-API-02_oracle_offchain.sh` against live endpoint.
// =============================================================================

const { expect } = require("chai");
const { ethers }  = require("hardhat");

describe("TC-API-02 | Oracle Data Feed Manipulation & Document Integrity", function () {
  let companyRegistry, tradeManager, shipmentTracker, mockToken;
  let deployer, buyer, seller, attacker;

  const APPROVED_COMPANY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("APPROVED_COMPANY"));
  const FUTURE = Math.floor(Date.now() / 1000) + 86400 * 90;
  const TRADE_EXPIRY = Math.floor(Date.now() / 1000) + 86400 * 30;
  const DISPUTE_WINDOW = 86400 * 7;

  beforeEach(async function () {
    [deployer, buyer, seller, attacker] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await Registry.deploy();
    await companyRegistry.waitForDeployment();

    const TM = await ethers.getContractFactory("TradeManager");
    tradeManager = await TM.deploy(await companyRegistry.getAddress());
    await tradeManager.waitForDeployment();

    const Token = await ethers.getContractFactory("MockERC20");
    mockToken = await Token.deploy("TestUSD", "TUSD", 18);
    await mockToken.waitForDeployment();

    const ST = await ethers.getContractFactory("ShipmentTracker");
    shipmentTracker = await ST.deploy();
    await shipmentTracker.waitForDeployment();

    // Setup registry
    await companyRegistry.connect(buyer).registerCompany(
      "Buyer Corp", "B-001", "NZ", "buyer@test.com", 0
    );
    await companyRegistry.connect(seller).registerCompany(
      "Seller Corp", "S-001", "AU", "seller@test.com", 1
    );
    await companyRegistry.approveCompany(await buyer.getAddress());
    await companyRegistry.approveCompany(await seller.getAddress());

    // Grant APPROVED_COMPANY role to seller for ShipmentTracker
    await shipmentTracker.grantRole(APPROVED_COMPANY_ROLE, await seller.getAddress());
  });

  // ── Helper: create a shipment ─────────────────────────────────────────────
  async function createShipment() {
    const tx = await shipmentTracker.connect(seller).createShipment(
      "LNG", 5000, "MMBtu", "Qatar", "Japan",
      await seller.getAddress(), FUTURE, "LNG-TRK-001"
    );
    const receipt = await tx.wait();
    return receipt.logs.find(l => l.fragment?.name === "ShipmentCreated").args[0];
  }

  // ── Helper: create a trade ────────────────────────────────────────────────
  async function createTrade(shipmentId = 0) {
    const tx = await tradeManager.connect(buyer).createTrade(
      await seller.getAddress(),
      "LNG", 5000, "MMBtu",
      ethers.parseEther("3"),
      await mockToken.getAddress(),
      "DAT", shipmentId,
      TRADE_EXPIRY, DISPUTE_WINDOW,
      ethers.parseEther("15000")
    );
    const receipt = await tx.wait();
    return receipt.logs.find(l => l.fragment?.name === "TradeCreated").args[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  it("PASS: Checkpoint data hash stored matches original data hash", async function () {
    const shipmentId = await createShipment();

    // Simulate oracle data payload
    const oracleData = JSON.stringify({
      temperature: 22.5,
      humidity: 65,
      pressure: 1013,
      timestamp: Date.now(),
      location: "Port of Hamad",
    });
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(oracleData));

    await shipmentTracker.connect(seller).addShipmentCheckpoint(
      shipmentId, "Port of Hamad", 22, 65, dataHash
    );

    const checkpoints = await shipmentTracker.getCheckpoints(shipmentId);
    expect(checkpoints.length).to.equal(1);
    expect(checkpoints[0].dataHash).to.equal(dataHash);

    console.log(`  ✅ Oracle data hash committed on-chain: ${dataHash}`);
    console.log("  ✅ Stored hash matches original oracle data hash");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("SECURITY: Tampered oracle data produces different hash (detectable)", async function () {
    const shipmentId = await createShipment();

    // Original oracle data
    const originalData = JSON.stringify({ temperature: 22.5, humidity: 65, location: "Port A" });
    const originalHash = ethers.keccak256(ethers.toUtf8Bytes(originalData));

    await shipmentTracker.connect(seller).addShipmentCheckpoint(
      shipmentId, "Port A", 22, 65, originalHash
    );

    // Tampered data (temperature changed by 1 degree – subtle manipulation)
    const tamperedData  = JSON.stringify({ temperature: 23.5, humidity: 65, location: "Port A" });
    const tamperedHash  = ethers.keccak256(ethers.toUtf8Bytes(tamperedData));

    // The hashes must differ
    expect(originalHash).to.not.equal(tamperedHash);

    // If a verifier recomputes the hash from the tampered data, they get a mismatch
    const checkpoints = await shipmentTracker.getCheckpoints(shipmentId);
    const storedHash  = checkpoints[0].dataHash;
    expect(storedHash).to.equal(originalHash);
    expect(storedHash).to.not.equal(tamperedHash);

    console.log(`  Original hash : ${originalHash}`);
    console.log(`  Tampered hash : ${tamperedHash}`);
    console.log("  ✅ Tampered oracle data detected via hash mismatch");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("SECURITY: Unauthorized party cannot submit checkpoint data", async function () {
    const shipmentId = await createShipment();
    const fakeHash   = ethers.keccak256(ethers.toUtf8Bytes("malicious data"));

    // Attacker does NOT have APPROVED_COMPANY role
    await expect(
      shipmentTracker.connect(attacker).addShipmentCheckpoint(
        shipmentId, "Attacker Port", 50, 99, fakeHash
      )
    ).to.be.revertedWith("Not approved company");

    console.log("✅ Unauthorized oracle data submission correctly rejected");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("SECURITY: Attacker cannot overwrite committed checkpoint data", async function () {
    const shipmentId = await createShipment();

    const legit = ethers.keccak256(ethers.toUtf8Bytes("real delivery data"));
    await shipmentTracker.connect(seller).addShipmentCheckpoint(
      shipmentId, "Port A", 22, 65, legit
    );

    // Even if attacker somehow calls (they can't due to role check), a second
    // addShipmentCheckpoint does NOT overwrite – it appends.
    // Here we verify that the array grows and original is preserved.
    await shipmentTracker.grantRole(APPROVED_COMPANY_ROLE, await attacker.getAddress());
    const fake = ethers.keccak256(ethers.toUtf8Bytes("manipulated data"));
    await shipmentTracker.connect(attacker).addShipmentCheckpoint(
      shipmentId, "Attacker Port", 99, 99, fake
    );

    const checkpoints = await shipmentTracker.getCheckpoints(shipmentId);
    // Original checkpoint still has the original hash
    expect(checkpoints[0].dataHash).to.equal(legit);
    expect(checkpoints[1].dataHash).to.equal(fake);
    expect(checkpoints.length).to.equal(2);

    console.log("  ⚠️  Checkpoint array is append-only – original data preserved");
    console.log("  ⚠️  NOTE: If attacker is APPROVED_COMPANY, they can append false checkpoints");
    console.log("  → Recommendation: restrict checkpoint submission to designated oracle address");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("PASS: uploadDocument() emits event with correct hash (on-chain evidence)", async function () {
    const tradeId = await createTrade();
    const docURI  = "ipfs://QmExampleDocumentHash";
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("trade-document-content-v1"));

    await expect(
      tradeManager.connect(buyer).uploadDocument(tradeId, docURI, docHash)
    ).to.emit(tradeManager, "DocumentUploaded")
     .withArgs(tradeId, docURI, docHash);

    console.log(`  ✅ DocumentUploaded event: tradeId=${tradeId} hash=${docHash}`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("SECURITY: Non-party cannot upload documents to a trade", async function () {
    const tradeId = await createTrade();
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("attacker document"));

    await expect(
      tradeManager.connect(attacker).uploadDocument(tradeId, "ipfs://fake", docHash)
    ).to.be.revertedWith("Not party to trade");

    console.log("✅ Non-party document upload correctly rejected");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("SECURITY: Checkpoint with empty location must revert", async function () {
    const shipmentId = await createShipment();
    const dataHash   = ethers.keccak256(ethers.toUtf8Bytes("data"));

    await expect(
      shipmentTracker.connect(seller).addShipmentCheckpoint(
        shipmentId, "", 22, 65, dataHash // empty location
      )
    ).to.be.revertedWith("Location required");

    console.log("✅ Empty location oracle input correctly rejected");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("SECURITY: Checkpoint for non-existent shipment must revert", async function () {
    const dataHash = ethers.keccak256(ethers.toUtf8Bytes("data"));
    await expect(
      shipmentTracker.connect(seller).addShipmentCheckpoint(
        99999, "SomePort", 22, 65, dataHash
      )
    ).to.be.revertedWith("Shipment does not exist");

    console.log("✅ Checkpoint injection for non-existent shipment correctly rejected");
  });

  // ─────────────────────────────────────────────────────────────────────────
  it("AUDIT: Zero dataHash (0x000...0) is technically accepted – potential blind oracle", async function () {
    // A zero hash could indicate an oracle submitted data without a real hash.
    // This is not a hard block in the contract but is a data quality finding.
    const shipmentId = await createShipment();
    const zeroHash   = ethers.ZeroHash;

    const tx = await shipmentTracker.connect(seller).addShipmentCheckpoint(
      shipmentId, "Port X", 20, 50, zeroHash
    );
    await tx.wait();

    const checkpoints = await shipmentTracker.getCheckpoints(shipmentId);
    expect(checkpoints[0].dataHash).to.equal(zeroHash);

    console.warn("  ⚠️  AUDIT: Zero dataHash accepted – no hash validation enforced by contract");
    console.warn("  → Recommendation: require(dataHash != bytes32(0)) in addShipmentCheckpoint()");
  });
});
