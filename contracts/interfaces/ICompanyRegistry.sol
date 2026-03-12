// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICompanyRegistry {
    enum CompanyStatus { PENDING, APPROVED, SUSPENDED }
    enum CompanyRole { BUYER, SELLER, BOTH }

    struct Company {
        string legalName;
        string registrationId;
        string country;
        string contactEmail;
        address walletAddress;
        CompanyRole role;
        CompanyStatus status;
        uint256 createdAt;
    }

    event CompanyRegistered(
        address indexed companyWallet,
        string legalName,
        string registrationId,
        string country,
        string contactEmail,
        CompanyRole role
    );

    event CompanyApproved(address indexed companyWallet);
    event CompanySuspended(address indexed companyWallet);
    event CompanyRoleUpdated(address indexed companyWallet, CompanyRole newRole);

    function registerCompany(
        string memory _legalName,
        string memory _registrationId,
        string memory _country,
        string memory _contactEmail,
        CompanyRole _role
    ) external;

    function approveCompany(address _companyWallet) external;
    function suspendCompany(address _companyWallet) external;
    function updateCompanyRole(address _companyWallet, CompanyRole _newRole) external;
    
    function getCompany(address _companyWallet) external view returns (Company memory);
    function isApprovedCompany(address _companyWallet) external view returns (bool);
    function isBuyer(address _companyWallet) external view returns (bool);
    function isSeller(address _companyWallet) external view returns (bool);
}