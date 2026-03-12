import { expect } from "chai";
import { ethers } from "hardhat";
import { ContractTransactionResponse } from "ethers";

describe("TradeManager", function () {
  let tradeManager: any;
  let companyRegistry: any;
  let mockToken: any;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let addr3: any;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();

    const CompanyRegistry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await CompanyRegistry.deploy();
    await companyRegistry.waitForDeployment();

    const TradeManager = await ethers.getContractFactory("TradeManager");
    tradeManager = await TradeManager.deploy(await companyRegistry.getAddress());
    await tradeManager.waitForDeployment();

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
  });

  describe("Trade Creation", function () {
    it("Should create a trade", async function () {
      const tx = await tradeManager.connect(addr1).createTrade(
        addr2.address, // seller
        "Wheat",
        ethers.parseEther("100"),
        "tons",
        ethers.parseEther("1000"), // $1000 per ton
        await mockToken.getAddress(),
        "FOB",
        1, // shipment ID
        Math.floor(Date.now() / 1000) + 86400, // 1 day from now
        86400, // 1 day dispute window
        ethers.parseEther("10000") // 10% deposit
      );

      const receipt = await tx.wait();
      const tradeCreatedEvent = receipt?.logs.find((log: any) => 
        log.fragment.name === "TradeCreated"
      );

      expect(tradeCreatedEvent).to.not.be.undefined;

      const tradeId = tradeCreatedEvent.args.tradeId;
      const trade = await tradeManager.getTrade(tradeId);
      
      expect(trade.buyer).to.equal(addr1.address);
      expect(trade.seller).to.equal(addr2.address);
      expect(trade.commodityType).to.equal("Wheat");
      expect(trade.quantity).to.equal(ethers.parseEther("100"));
      expect(trade.status).to.equal(0); // CREATED
    });

    it("Should reject unapproved companies from creating trades", async function () {
      await companyRegistry.connect(addr3).registerCompany(
        "Unapproved Corp",
        "UNAPP789",
        "USA",
        "unapp@test.com",
        0
      );

      await expect(
        tradeManager.connect(addr3).createTrade(
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
        )
      ).to.be.revertedWith("Creator not approved");
    });
  });

  describe("Trade Acceptance", function () {
    let tradeId: any;

    beforeEach(async function () {
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
    });

    it("Should allow seller to accept trade", async function () {
      // Create EIP-712 signature for acceptance
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

      await expect(
        tradeManager.connect(addr2).acceptTrade(tradeId, signature)
      ).to.emit(tradeManager, "TradeAccepted");

      const trade = await tradeManager.getTrade(tradeId);
      expect(trade.status).to.equal(1); // ACCEPTED
    });
  });
});