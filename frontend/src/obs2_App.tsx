import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import WalletConnect from './components/WalletConnect';
import CompanyOnboarding from './components/CompanyOnboarding';
import TradeManagement from './components/TradeManagement';
import ShipmentTracking from './components/ShipmentTracking';
import './App.css';

// Import contract ABIs (these would normally be imported from generated files)
const companyRegistryABI = [
  "function registerCompany(string memory _legalName, string memory _registrationId, string memory _country, string memory _contactEmail, uint8 _role) external",
  "function approveCompany(address _companyWallet) external",
  "function getCompany(address _companyWallet) external view returns (tuple(string legalName, string registrationId, string country, string contactEmail, address walletAddress, uint8 role, uint8 status, uint256 createdAt) memory)",
  "function isApprovedCompany(address _companyWallet) external view returns (bool)"
];

const tradeManagerABI = [
  "function createTrade(address _seller, string memory _commodityType, uint256 _quantity, string memory _unit, uint256 _pricePerUnit, address _paymentToken, string memory _incoterms, uint256 _shipmentId, uint256 _expiryTimestamp, uint256 _disputeWindowDuration, uint256 _depositAmount) external returns (uint256)",
  "function acceptTrade(uint256 _tradeId, bytes memory _signature) external",
  "function getTrade(uint256 _tradeId) external view returns (tuple(uint256 id, address buyer, address seller, string commodityType, uint256 quantity, string unit, uint256 pricePerUnit, address paymentToken, string incoterms, uint256 shipmentId, uint256 expiryTimestamp, uint256 disputeWindowEnds, uint256 depositAmount, uint8 status, uint256 createdAt, bytes32 buyerSignatureHash, bytes32 sellerSignatureHash, bytes32 finalConfirmationHash) memory)",
  "function getNonce(address _address) external view returns (uint256)"
];

const shipmentTrackerABI = [
  "function createShipment(string memory _commodityType, uint256 _quantity, string memory _unit, string memory _origin, string memory _destination, address _shipper, uint256 _expectedDeliveryDate, string memory _trackingId) external returns (uint256)",
  "function getShipment(uint256 _shipmentId) external view returns (tuple(uint256 id, address creator, string commodityType, uint256 quantity, string unit, string origin, string destination, address shipper, uint256 expectedDeliveryDate, string trackingId, uint8 status, uint256 createdAt) memory)",
  "function getStatusUpdates(uint256 _shipmentId) external view returns (tuple(uint8 status, string details, uint256 timestamp, address updater)[] memory)",
  "function getCheckpoints(uint256 _shipmentId) external view returns (tuple(string location, int256 temperature, int256 humidity, uint256 timestamp, bytes32 dataHash)[] memory)"
];

const escrowPaymentsABI = [
  "function fundEscrow(uint256 _tradeId, uint256 _amount) external",
  "function releasePayment(uint256 _tradeId) external",
  "function getEscrow(uint256 _tradeId) external view returns (tuple(uint256 tradeId, address buyer, address seller, address paymentToken, uint256 totalAmount, uint256 releasedAmount, bool isReleased, bool isRefunded, uint256 disputeStartTime, bool inDispute) memory)"
];

const mockTokenABI = [
  "function approve(address spender, uint256 value) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)"
];

// Contract addresses (replace with actual deployed addresses)
const CONTRACT_ADDRESSES = {
  COMPANY_REGISTRY: "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Example address
  TRADE_MANAGER: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  SHIPMENT_TRACKER: "0x9fE46736679d2D9a65F0992F19A3554254929C4e",
  ESCROW_PAYMENTS: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  MOCK_TOKEN: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"
};

function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<any>(null);
  const [companyRegistry, setCompanyRegistry] = useState<any>(null);
  const [tradeManager, setTradeManager] = useState<any>(null);
  const [shipmentTracker, setShipmentTracker] = useState<any>(null);
  const [escrowPayments, setEscrowPayments] = useState<any>(null);
  const [mockToken, setMockToken] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('company');

  useEffect(() => {
    const initContracts = async () => {
      if (provider && account) {
        try {
          // getSigner() is asynchronous in ethers v6
          const signer = await provider.getSigner();

          // Initialize contract instances
          const companyReg = new ethers.Contract(
            CONTRACT_ADDRESSES.COMPANY_REGISTRY,
            companyRegistryABI,
            signer
          );

          const tradeMgr = new ethers.Contract(
            CONTRACT_ADDRESSES.TRADE_MANAGER,
            tradeManagerABI,
            signer
          );

          const shipmentTrack = new ethers.Contract(
            CONTRACT_ADDRESSES.SHIPMENT_TRACKER,
            shipmentTrackerABI,
            signer
          );

          const escrowPay = new ethers.Contract(
            CONTRACT_ADDRESSES.ESCROW_PAYMENTS,
            escrowPaymentsABI,
            signer
          );

          const mockTok = new ethers.Contract(
            CONTRACT_ADDRESSES.MOCK_TOKEN,
            mockTokenABI,
            signer
          );

          setCompanyRegistry(companyReg);
          setTradeManager(tradeMgr);
          setShipmentTracker(shipmentTrack);
          setEscrowPayments(escrowPay);
          setMockToken(mockTok);
        } catch (error) {
          console.error("Failed to initialize contracts:", error);
        }
      }
    };

    initContracts();
  }, [provider, account]);

  const handleConnect = (acc: string, prov: any) => {
    setAccount(acc);
    setProvider(prov);
  };

  const handleDisconnect = () => {
    setAccount(null);
    setProvider(null);
    setCompanyRegistry(null);
    setTradeManager(null);
    setShipmentTracker(null);
    setEscrowPayments(null);
    setMockToken(null);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Commodity Trading Platform</h1>
        <WalletConnect onConnect={handleConnect} onDisconnect={handleDisconnect} />
      </header>

      <nav>
        <button
          className={activeTab === 'company' ? 'active' : ''}
          onClick={() => setActiveTab('company')}
        >
          Company Onboarding
        </button>
        <button
          className={activeTab === 'trade' ? 'active' : ''}
          onClick={() => setActiveTab('trade')}
        >
          Trade Management
        </button>
        <button
          className={activeTab === 'shipment' ? 'active' : ''}
          onClick={() => setActiveTab('shipment')}
        >
          Shipment Tracking
        </button>
      </nav>

      <main>
        {account ? (
          <>
            {activeTab === 'company' && companyRegistry && (
              <CompanyOnboarding
                companyRegistry={companyRegistry}
                account={account}
              />
            )}

            {activeTab === 'trade' && tradeManager && escrowPayments && mockToken && (
              <TradeManagement
                tradeManager={tradeManager}
                escrowPayments={escrowPayments}
                mockToken={mockToken}
                account={account}
              />
            )}

            {activeTab === 'shipment' && shipmentTracker && (
              <ShipmentTracking
                shipmentTracker={shipmentTracker}
                account={account}
              />
            )}
          </>
        ) : (
          <div className="connect-wallet-prompt">
            <p>Please connect your wallet to use the platform</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;