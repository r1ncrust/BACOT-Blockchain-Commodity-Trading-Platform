// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/ICompanyRegistry.sol";

contract CompanyRegistry is ICompanyRegistry, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");

    mapping(address => Company) private companies;
    mapping(address => bool) private nonces;

    modifier onlyApprovedCompany() {
        require(companies[msg.sender].status == CompanyStatus.APPROVED, "Company not approved");
        _;
    }

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Not admin");
        _;
    }

    modifier onlyReviewer() {
        require(hasRole(REVIEWER_ROLE, msg.sender) || hasRole(ADMIN_ROLE, msg.sender), "Not reviewer");
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(REVIEWER_ROLE, msg.sender);
    }

    function registerCompany(
        string memory _legalName,
        string memory _registrationId,
        string memory _country,
        string memory _contactEmail,
        CompanyRole _role
    ) external {
        require(bytes(_legalName).length > 0, "Legal name required");
        require(bytes(_registrationId).length > 0, "Registration ID required");
        require(bytes(_country).length > 0, "Country required");
        require(bytes(_contactEmail).length > 0, "Contact email required");
        
        companies[msg.sender] = Company({
            legalName: _legalName,
            registrationId: _registrationId,
            country: _country,
            contactEmail: _contactEmail,
            walletAddress: msg.sender,
            role: _role,
            status: CompanyStatus.PENDING,
            createdAt: block.timestamp
        });

        emit CompanyRegistered(msg.sender, _legalName, _registrationId, _country, _contactEmail, _role);
    }

    function approveCompany(address _companyWallet) external onlyReviewer {
        require(companies[_companyWallet].walletAddress != address(0), "Company not registered");
        companies[_companyWallet].status = CompanyStatus.APPROVED;
        emit CompanyApproved(_companyWallet);
    }

    function suspendCompany(address _companyWallet) external onlyReviewer {
        require(companies[_companyWallet].walletAddress != address(0), "Company not registered");
        companies[_companyWallet].status = CompanyStatus.SUSPENDED;
        emit CompanySuspended(_companyWallet);
    }

    function updateCompanyRole(address _companyWallet, CompanyRole _newRole) external onlyReviewer {
        require(companies[_companyWallet].walletAddress != address(0), "Company not registered");
        companies[_companyWallet].role = _newRole;
        emit CompanyRoleUpdated(_companyWallet, _newRole);
    }

    function getCompany(address _companyWallet) external view returns (Company memory) {
        return companies[_companyWallet];
    }

    function isApprovedCompany(address _companyWallet) external view returns (bool) {
        return companies[_companyWallet].status == CompanyStatus.APPROVED;
    }

    function isBuyer(address _companyWallet) external view returns (bool) {
        Company memory company = companies[_companyWallet];
        return company.status == CompanyStatus.APPROVED && 
               (company.role == CompanyRole.BUYER || company.role == CompanyRole.BOTH);
    }

    function isSeller(address _companyWallet) external view returns (bool) {
        Company memory company = companies[_companyWallet];
        return company.status == CompanyStatus.APPROVED && 
               (company.role == CompanyRole.SELLER || company.role == CompanyRole.BOTH);
    }
}