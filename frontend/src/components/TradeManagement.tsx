import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Trade } from '../types';

interface TradeManagementProps {
  tradeManager: any;
  escrowPayments: any;
  mockToken: any;
  shipmentTracker: any;
  account: string;
}

const TradeManagement: React.FC<TradeManagementProps> = ({
  tradeManager,
  escrowPayments,
  mockToken,
  shipmentTracker,
  account
}) => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tokenBalance, setTokenBalance] = useState<string>('0');
  const [newTrade, setNewTrade] = useState({
    seller: '',
    commodityType: '',
    quantity: '',
    unit: 'tons',
    pricePerUnit: '',
    paymentToken: '',
    incoterms: 'FOB',
    shipmentId: '1',
    expiryDays: '7',
    disputeWindowDays: '7',
    depositPercent: '10'
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fetchTokenBalance = async () => {
    try {
      if (!mockToken || !account) return;
      const bal = await mockToken.balanceOf(account);
      setTokenBalance(ethers.formatUnits(bal, 18));
    } catch (err) {
      console.error('Error fetching token balance:', err);
    }
  };

  useEffect(() => {
    fetchTrades();
    fetchTokenBalance();

    // Prefill the paymentToken address to prevent invalid token trades
    if (mockToken && mockToken.target && !newTrade.paymentToken) {
      setNewTrade(prev => ({ ...prev, paymentToken: mockToken.target as string }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeManager, account, mockToken]);

  const fetchTrades = async () => {
    try {
      if (!tradeManager || !account) return;

      const userTrades = [];
      let currentId = 1;

      // 1. Fetch all shipments to map which trades have shipments
      const tradeShipmentMap = new Map<string, boolean>();
      if (shipmentTracker) {
        try {
          let sId = 1;
          while (true) {
            const sh = await shipmentTracker.getShipment(sId);
            if (!sh || sh.id.toString() === "0") break;

            // Extract trade ID from trackingId format: "TRADE-{tradeId}-{timestamp}"
            if (sh.trackingId && sh.trackingId.startsWith('TRADE-')) {
              const parts = sh.trackingId.split('-');
              if (parts.length >= 2) {
                tradeShipmentMap.set(parts[1], true);
              }
            }
            sId++;
          }
        } catch (err) {
          console.error("Finished checking shipments config", err);
        }
      }

      while (true) {
        try {
          console.log(`Fetching trade ID ${currentId}...`);
          const trade = await tradeManager.getTrade(currentId);
          console.log(`Result for ID ${currentId}:`, trade);

          // If the trade doesn't exist, its id will be 0 (default struct value)
          if (!trade || trade.id.toString() === "0") {
            console.log(`Trade ID ${currentId} is empty (id=0). Stopping loop.`);
            break;
          }

          console.log(`Comparing trade buyer (${trade.buyer}) and seller (${trade.seller}) with account (${account})`);
          // Check if the current account is either the buyer or the seller
          if (
            trade.buyer.toLowerCase() === account.toLowerCase() ||
            trade.seller.toLowerCase() === account.toLowerCase()
          ) {
            console.log(`Trade ID ${currentId} belongs to user.`);
            userTrades.push({
              ...trade,
              hasShipment: tradeShipmentMap.has(currentId.toString())
            });
          } else {
            console.log(`Trade ID ${currentId} does NOT belong to user.`);
          }
          currentId++;
        } catch (err) {
          console.error(`Stopped fetching at ID ${currentId} due to contract error:`, err);
          break;
        }
      }

      // Sort trades to show newest first
      userTrades.sort((a: any, b: any) => Number(b.id) - Number(a.id));

      setTrades(userTrades);
    } catch (error) {
      console.error("Error fetching trades:", error);
    }
  };

  const handleCreateTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const expiryTimestamp = Math.floor(Date.now() / 1000) + (parseInt(newTrade.expiryDays || "0") * 86400);
      const disputeWindowDuration = parseInt(newTrade.disputeWindowDays || "0") * 86400;

      const qWei = ethers.parseUnits(newTrade.quantity || "0", 18);
      const pWei = ethers.parseUnits(newTrade.pricePerUnit || "0", 18);
      const depositPct = BigInt(newTrade.depositPercent || "0");

      const totalValueWei = (qWei * pWei) / BigInt("1000000000000000000");
      const depositAmount = (totalValueWei * depositPct) / BigInt(100);

      const tx = await tradeManager.createTrade(
        newTrade.seller,
        newTrade.commodityType,
        qWei,
        newTrade.unit,
        pWei,
        newTrade.paymentToken,
        newTrade.incoterms,
        parseInt(newTrade.shipmentId || "0"),
        expiryTimestamp,
        disputeWindowDuration,
        depositAmount
      );
      await tx.wait();
      setMessage('Trade created successfully!');
      fetchTrades();
      setNewTrade({
        seller: '',
        commodityType: '',
        quantity: '',
        unit: 'tons',
        pricePerUnit: '',
        paymentToken: '',
        incoterms: 'FOB',
        shipmentId: '1',
        expiryDays: '7',
        disputeWindowDays: '7',
        depositPercent: '10'
      });
    } catch (error: any) {
      console.error('Error creating trade:', error);
      setMessage(`Error: ${error.message || 'Failed to create trade'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptTrade = async (tradeId: any) => {
    try {
      const network = await tradeManager.runner.provider.getNetwork();
      const domain = {
        name: "TradeManager",
        version: "1",
        chainId: network.chainId,
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

      const nonce = await tradeManager.getNonce(account);
      const deadline = Math.floor(Date.now() / 1000) + 86400; // 1 day

      const value = {
        tradeId: tradeId,
        signer: account,
        nonce: nonce,
        deadline: deadline,
      };

      const signature = await tradeManager.runner.signTypedData(domain, types, value);

      const tx = await tradeManager.acceptTrade(tradeId, signature);
      await tx.wait();
      setMessage('Trade accepted successfully!');
      fetchTrades();
    } catch (error: any) {
      console.error('Error accepting trade:', error);
      setMessage(`Error: ${error.message || 'Failed to accept trade'}`);
    }
  };

  const handleDeclineTrade = async (tradeId: any) => {
    try {
      const tx = await tradeManager.cancelTrade(tradeId);
      await tx.wait();
      setMessage('Trade declined successfully!');
      fetchTrades();
    } catch (error: any) {
      console.error('Error declining trade:', error);
      setMessage(`Error: ${error.message || 'Failed to decline trade'}`);
    }
  };

  const handleLockTrade = async (tradeId: any) => {
    try {
      const tx = await tradeManager.lockTrade(tradeId);
      await tx.wait();
      setMessage('Trade locked successfully!');
      fetchTrades();
    } catch (error: any) {
      console.error('Error locking trade:', error);
      setMessage(`Error: ${error.message || 'Failed to lock trade'}`);
    }
  };

  const handleFundEscrow = async (tradeId: number, amount: string) => {
    try {
      // Get the trade to find its required payment token
      const trade = await tradeManager.getTrade(tradeId);

      // Dynamically connect to the trade's payment token
      const tokenContract = new ethers.Contract(
        trade.paymentToken,
        [
          "function approve(address spender, uint256 amount) public returns (bool)",
          "function allowance(address owner, address spender) public view returns (uint256)",
          "function balanceOf(address account) public view returns (uint256)"
        ],
        tradeManager.runner
      );

      // Check balance before approving
      const balance = await tokenContract.balanceOf(account);
      const parsedAmount = ethers.parseUnits(amount, 18);

      if (balance < parsedAmount) {
        throw new Error(`Insufficient token balance. You have ${ethers.formatUnits(balance, 18)} but need ${amount}.`);
      }

      // First approve the token spending
      console.log(`Approving ${amount} tokens on contract ${trade.paymentToken}...`);
      const tx1 = await tokenContract.approve(
        await escrowPayments.getAddress(),
        parsedAmount
      );
      await tx1.wait();

      // Then fund the escrow
      console.log(`Funding escrow for trade ${tradeId}...`);
      const tx2 = await escrowPayments.fundEscrow(
        tradeId,
        parsedAmount
      );
      await tx2.wait();
      setMessage('Escrow funded successfully!');
      fetchTrades();
      fetchTokenBalance();
    } catch (error: any) {
      console.error('Error funding escrow:', error);
      setMessage(`Error: ${error.reason || error.message || 'Failed to fund escrow'}`);
    }
  };

  const handleReleasePayment = async (tradeId: number) => {
    try {
      const tx = await escrowPayments.releasePayment(tradeId);
      await tx.wait();
      setMessage('Payment released successfully!');
      fetchTrades();
      fetchTokenBalance();
    } catch (error: any) {
      console.error('Error releasing payment:', error);
      setMessage(`Error: ${error.message || 'Failed to release payment'}`);
    }
  };

  return (
    <div className="trade-management">
      <div style={{ background: '#e8f5e9', border: '1px solid #4CAF50', borderRadius: '8px', padding: '12px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>💰 Your tUSD Balance:</strong> <span style={{ fontSize: '1.2em', color: '#2e7d32' }}>{parseFloat(tokenBalance).toLocaleString()}</span> tUSD
        </div>
        <button onClick={fetchTokenBalance} style={{ padding: '6px 12px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
          Refresh Balance
        </button>
      </div>
      <h2>Create New Trade</h2>
      <form onSubmit={handleCreateTrade}>
        <div>
          <label>Seller Address:</label>
          <input
            type="text"
            value={newTrade.seller}
            onChange={(e) => setNewTrade({ ...newTrade, seller: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Commodity Type:</label>
          <input
            type="text"
            value={newTrade.commodityType}
            onChange={(e) => setNewTrade({ ...newTrade, commodityType: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Quantity:</label>
          <input
            type="number"
            value={newTrade.quantity}
            onChange={(e) => setNewTrade({ ...newTrade, quantity: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Unit:</label>
          <select
            value={newTrade.unit}
            onChange={(e) => setNewTrade({ ...newTrade, unit: e.target.value })}
          >
            <option value="tons">Tons</option>
            <option value="kg">Kilograms</option>
            <option value="lbs">Pounds</option>
          </select>
        </div>
        <div>
          <label>Price Per Unit (ETH):</label>
          <input
            type="number"
            step="0.000000000000000001"
            value={newTrade.pricePerUnit}
            onChange={(e) => setNewTrade({ ...newTrade, pricePerUnit: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Payment Token (tUSD):</label>
          <input
            type="text"
            value={newTrade.paymentToken}
            readOnly
            style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
            title="Auto-filled with deployed MockToken (tUSD) address"
          />
          <small style={{ color: '#666' }}>Auto-filled with deployed tUSD test token</small>
        </div>
        <div>
          <label>Expiry Days:</label>
          <input
            type="number"
            value={newTrade.expiryDays}
            onChange={(e) => setNewTrade({ ...newTrade, expiryDays: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Deposit %:</label>
          <input
            type="number"
            value={newTrade.depositPercent}
            onChange={(e) => setNewTrade({ ...newTrade, depositPercent: e.target.value })}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Trade'}
        </button>
      </form>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', marginTop: '30px' }}>
        <h2 style={{ margin: 0 }}>Your Trades</h2>
        <button
          onClick={(e) => {
            e.preventDefault();
            fetchTrades();
          }}
          style={{ padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Refresh Trades
        </button>
      </div>
      <div className="trades-list">
        {trades.length === 0 ? (
          <p>No trades found.</p>
        ) : (
          <div className="trades-grid" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {trades.map((trade: any, index: number) => (
              <div key={index} className="trade-card" style={{ border: '1px solid #eee', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <h3 style={{ marginTop: 0, borderBottom: '1px solid #eee', paddingBottom: '10px' }}>Trade #{trade.id.toString()}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                  <p><strong>Commodity:</strong> {trade.commodityType}</p>
                  <p><strong>Quantity:</strong> {ethers.formatUnits(trade.quantity, 18)} {trade.unit}</p>
                  <p><strong>Price/Unit:</strong> {ethers.formatUnits(trade.pricePerUnit, 18)} Tokens</p>
                  <p><strong>Deposit:</strong> {ethers.formatUnits(trade.depositAmount, 18)} Tokens</p>
                  <p><strong>Seller:</strong> {trade.seller.slice(0, 6)}...{trade.seller.slice(-4)}</p>
                  <p><strong>Buyer:</strong> {trade.buyer.slice(0, 6)}...{trade.buyer.slice(-4)}</p>
                  <p><strong>Status:</strong> {
                    Number(trade.status) === 2 && trade.hasShipment
                      ? <strong style={{ color: '#4CAF50' }}>SHIPMENT CREATED</strong>
                      : ['CREATED', 'ACCEPTED', 'LOCKED', 'EXECUTED', 'CLOSED', 'CANCELLED', 'DISPUTED'][Number(trade.status)]
                  }</p>
                </div>

                <div className="trade-actions" style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #eee', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  {Number(trade.status) === 0 && (
                    <>
                      {trade.seller.toLowerCase() === account.toLowerCase() && (
                        <button onClick={() => handleAcceptTrade(trade.id)} className="action-btn">Accept Trade</button>
                      )}
                      <button onClick={() => handleDeclineTrade(trade.id)} className="action-btn" style={{ backgroundColor: '#f44336', color: 'white' }}>Decline Trade</button>
                    </>
                  )}
                  {Number(trade.status) === 1 && (
                    <button onClick={() => handleLockTrade(trade.id)} className="action-btn" style={{ backgroundColor: '#ff9800', color: 'white' }}>Lock Trade</button>
                  )}
                  {Number(trade.status) === 2 && (
                    <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                      <input
                        type="number"
                        step="0.01"
                        id={`fundAmount-${trade.id}`}
                        placeholder="Amount"
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', width: '100px' }}
                      />
                      <button onClick={(e) => {
                        e.preventDefault();
                        const amount = (document.getElementById(`fundAmount-${trade.id}`) as HTMLInputElement).value;
                        if (amount) handleFundEscrow(trade.id, amount);
                      }} className="action-btn">Fund Escrow</button>
                    </div>
                  )}
                  {Number(trade.status) === 3 && trade.buyer.toLowerCase() === account.toLowerCase() && (
                    <button onClick={() => handleReleasePayment(trade.id)} className="action-btn" style={{ backgroundColor: '#4CAF50', color: 'white' }}>Release Payment</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className={`message ${message.startsWith('Error') ? 'error' : ''}`}>{message}</p>}
    </div>
  );
};

export default TradeManagement;