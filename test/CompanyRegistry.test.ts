import { expect } from "chai";
import { ethers } from "hardhat";
import { ContractTransactionResponse } from "ethers";

describe("CompanyRegistry", function () {
  let companyRegistry: any;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let addr3: any;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3] = await ethers.getSigners();
    
    const CompanyRegistry = await ethers.getContractFactory("CompanyRegistry");
    companyRegistry = await CompanyRegistry.deploy();
    await companyRegistry.waitForDeployment();
  });

  describe("Company Registration", function () {
    it("Should allow company registration", async function () {
      await expect(
        companyRegistry.connect(addr1).registerCompany(
          "Test Corp",
          "REG123",
          "USA",
          "test@test.com",
          0 // BUYER role
        )
      ).to.emit(companyRegistry, "CompanyRegistered");

      const company = await companyRegistry.getCompany(addr1.address);
      expect(company.legalName).to.equal("Test Corp");
      expect(company.registrationId).to.equal("REG123");
      expect(company.country).to.equal("USA");
      expect(company.contactEmail).to.equal("test@test.com");
      expect(company.role).to.equal(0);
      expect(company.status).to.equal(0); // PENDING
    });

    it("Should reject invalid registration data", async function () {
      await expect(
        companyRegistry.connect(addr1).registerCompany(
          "", // Empty legal name
          "REG123",
          "USA",
          "test@test.com",
          0
        )
      ).to.be.revertedWith("Legal name required");

      await expect(
        companyRegistry.connect(addr1).registerCompany(
          "Test Corp",
          "", // Empty reg ID
          "USA",
          "test@test.com",
          0
        )
      ).to.be.revertedWith("Registration ID required");
    });
  });

  describe("Company Approval", function () {
    beforeEach(async function () {
      await companyRegistry.connect(addr1).registerCompany(
        "Test Corp",
        "REG123",
        "USA",
        "test@test.com",
        0
      );
    });

    it("Should allow admin to approve company", async function () {
      await expect(
        companyRegistry.approveCompany(addr1.address)
      ).to.emit(companyRegistry, "CompanyApproved");

      const company = await companyRegistry.getCompany(addr1.address);
      expect(company.status).to.equal(1); // APPROVED
    });

    it("Should allow reviewer to approve company", async function () {
      await companyRegistry.grantRole(
        ethers.keccak256(ethers.toUtf8Bytes("REVIEWER_ROLE")),
        addr2.address
      );

      await expect(
        companyRegistry.connect(addr2).approveCompany(addr1.address)
      ).to.emit(companyRegistry, "CompanyApproved");

      const company = await companyRegistry.getCompany(addr1.address);
      expect(company.status).to.equal(1); // APPROVED
    });

    it("Should check if company is approved", async function () {
      expect(await companyRegistry.isApprovedCompany(addr1.address)).to.be.false;
      
      await companyRegistry.approveCompany(addr1.address);
      expect(await companyRegistry.isApprovedCompany(addr1.address)).to.be.true;
    });
  });

  describe("Company Role Management", function () {
    beforeEach(async function () {
      await companyRegistry.connect(addr1).registerCompany(
        "Test Corp",
        "REG123",
        "USA",
        "test@test.com",
        0
      );
      await companyRegistry.approveCompany(addr1.address);
    });

    it("Should check if company is buyer/seller", async function () {
      expect(await companyRegistry.isBuyer(addr1.address)).to.be.true;
      expect(await companyRegistry.isSeller(addr1.address)).to.be.false;

      await companyRegistry.updateCompanyRole(addr1.address, 1); // SELLER
      expect(await companyRegistry.isBuyer(addr1.address)).to.be.false;
      expect(await companyRegistry.isSeller(addr1.address)).to.be.true;

      await companyRegistry.updateCompanyRole(addr1.address, 2); // BOTH
      expect(await companyRegistry.isBuyer(addr1.address)).to.be.true;
      expect(await companyRegistry.isSeller(addr1.address)).to.be.true;
    });
  });
});