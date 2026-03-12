import { expect } from "chai";
import { ethers } from "hardhat";

describe("EscrowPayments", function () {
  let escrowPayments: any;
  let tradeManager: any;
  let companyRegistry: any;
  let mockToken: any;
  let owner: any;
  let addr1: any;
  let addr2: any;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const CompanyRegistry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await CompanyRegistry.deploy();
    await companyRegistry.waitForDeployment();

    const TradeManager = await ethers.getContractFactory("TradeManager");
    tradeManager = await TradeManager.deploy(await companyRegistry.getAddress());
    await tradeManager.waitForDeployment();

    const EscrowPayments = await ethers.getContractFactory("EscrowPayments");
    escrowPayments = await EscrowPayments.deploy(await tradeManager.getAddress());
    await escrowPayments.waitForDeployment();

    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Test Token", "TTK", 18);
    await mockToken.waitForDeployment();

    // Register and approve companies
    await companyRegistry.connect(addr1).registerCompany(
      "Buyer Corp",
      "BUY123",
      "USA",
      "buyer@test.com",
      0 // BUYER
    );
    await companyRegistry.connect(addr2).registerCompany(
      "Seller Corp",
      "SELL456",
      "USA",
      "seller@test.com",
      1 // SELLER
    );
    await companyRegistry.approveCompany(addr1.address);
    await companyRegistry.approveCompany(addr2.address);

    // Mint tokens for testing
    await mockToken.mint(addr1.address, ethers.parseEther("100000"));
  });

  describe("Escrow Funding", function () {
    let tradeId: any;

    beforeEach(async function () {
      // Create a trade first
      const tx = await tradeManager.connect(addr1).createTrade(
        addr2.address,
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        ethers.parseEther("1000"),
        await mockToken.getAddress(),
        "FOB",
        1,
        Math.floor(Date.now() / 1000) + 86400,
        86400,
        ethers.parseEther("10000")
      );

      const receipt = await tx.wait();
      const tradeCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "TradeCreated"
      );
      tradeId = tradeCreatedEvent.args.tradeId;

      // Accept and lock the trade
      const domain = {
        name: "TradeManager",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await tradeManager.getAddress(),
      };

      const types = {
        Trade: [
          { name: "tradeId", type: "uint256" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        tradeId: tradeId,
        signer: addr2.address,
        nonce: await tradeManager.getNonce(addr2.address),
        deadline: Math.floor(Date.now() / 1000) + 86400,
      };

      const signature = await addr2.signTypedData(domain, types, value);
      await tradeManager.connect(addr2).acceptTrade(tradeId, signature);
      await tradeManager.lockTrade(tradeId);

      // Approve token spending
      await mockToken.connect(addr1).approve(await escrowPayments.getAddress(), ethers.parseEther("10000"));
    });

    it("Should fund escrow", async function () {
      const amount = ethers.parseEther("10000");
      
      await expect(
        escrowPayments.connect(addr1).fundEscrow(tradeId, amount)
      ).to.emit(escrowPayments, "EscrowFunded");

      const escrow = await escrowPayments.getEscrow(tradeId);
      expect(escrow.totalAmount).to.equal(amount);
      expect(escrow.isReleased).to.be.false;
      expect(escrow.isRefunded).to.be.false;
    });

    it("Should release payment after execution", async function () {
      const amount = ethers.parseEther("10000");
      
      // Fund escrow
      await escrowPayments.connect(addr1).fundEscrow(tradeId, amount);

      // Execute trade
      await tradeManager.executeTrade(tradeId);

      // Release payment
      await expect(
        escrowPayments.connect(addr1).releasePayment(tradeId)
      ).to.emit(escrowPayments, "EscrowReleased");

      const escrow = await escrowPayments.getEscrow(tradeId);
      expect(escrow.isReleased).to.be.true;
      expect(escrow.releasedAmount).to.equal(amount);
    });

    it("Should refund payment on cancellation", async function () {
      const amount = ethers.parseEther("10000");
      
      // Fund escrow
      await escrowPayments.connect(addr1).fundEscrow(tradeId, amount);

      // Cancel trade
      await tradeManager.cancelTrade(tradeId);

      // Refund payment
      await expect(
        escrowPayments.connect(addr1).refundPayment(tradeId)
      ).to.emit(escrowPayments, "EscrowRefunded");

      const escrow = await escrowPayments.getEscrow(tradeId);
      expect(escrow.isRefunded).to.be.true;
    });
  });

  describe("Dispute Resolution", function () {
    let tradeId: any;

    beforeEach(async function () {
      // Create and set up a trade
      const tx = await tradeManager.connect(addr1).createTrade(
        addr2.address,
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        ethers.parseEther("1000"),
        await mockToken.getAddress(),
        "FOB",
        1,
        Math.floor(Date.now() / 1000) + 86400,
        86400,
        ethers.parseEther("10000")
      );

      const receipt = await tx.wait();
      const tradeCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "TradeCreated"
      );
      tradeId = tradeCreatedEvent.args.tradeId;

      const domain = {
        name: "TradeManager",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await tradeManager.getAddress(),
      };

      const types = {
        Trade: [
          { name: "tradeId", type: "uint256" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const value = {
        tradeId: tradeId,
        signer: addr2.address,
        nonce: await tradeManager.getNonce(addr2.address),
        deadline: Math.floor(Date.now() / 1000) + 86400,
      };

      const signature = await addr2.signTypedData(domain, types, value);
      await tradeManager.connect(addr2).acceptTrade(tradeId, signature);
      await tradeManager.lockTrade(tradeId);

      // Approve and fund
      await mockToken.connect(addr1).approve(await escrowPayments.getAddress(), ethers.parseEther("10000"));
      await escrowPayments.connect(addr1).fundEscrow(tradeId, ethers.parseEther("10000"));

      // Execute trade
      await tradeManager.executeTrade(tradeId);
    });

    it("Should allow dispute initiation", async function () {
      await expect(
        escrowPayments.connect(addr1).initiateDispute(tradeId)
      ).to.emit(escrowPayments, "EscrowDisputed");

      const escrow = await escrowPayments.getEscrow(tradeId);
      expect(escrow.inDispute).to.be.true;
    });

    it("Should allow dispute resolution", async function () {
      // Initiate dispute
      await escrowPayments.connect(addr1).initiateDispute(tradeId);

      // Resolve dispute (release to seller)
      await expect(
        escrowPayments.resolveDispute(tradeId, 0, ethers.parseEther("10000"))
      ).to.emit(escrowPayments, "EscrowResolved");

      const escrow = await escrowPayments.getEscrow(tradeId);
      expect(escrow.isReleased).to.be.true;
    });
  });
});