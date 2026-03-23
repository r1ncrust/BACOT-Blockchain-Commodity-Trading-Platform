import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Trade } from '../types';

interface TradeManagementProps {
  tradeManager: any;
  escrowPayments: any;
  mockToken: any;
  account: string;
}

const TradeManagement: React.FC<TradeManagementProps> = ({
  tradeManager,
  escrowPayments,
  mockToken,
  account
}) => {
  const [trades, setTrades] = useState<Trade[]>([]);
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

  useEffect(() => {
    fetchTrades();
  }, [tradeManager]);

  const fetchTrades = async () => {
    // This would typically fetch from a backend or scan events
    // For now we'll just show a placeholder
  };

  const handleCreateTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const expiryTimestamp = Math.floor(Date.now() / 1000) + (parseInt(newTrade.expiryDays) * 86400);
      const disputeWindowDuration = parseInt(newTrade.disputeWindowDays) * 86400;
      const totalValue = BigInt(newTrade.quantity) * BigInt(newTrade.pricePerUnit);
      const depositAmount = (totalValue * BigInt(newTrade.depositPercent)) / BigInt(100);

      const tx = await tradeManager.createTrade(
        newTrade.seller,
        newTrade.commodityType,
        ethers.parseUnits(newTrade.quantity, 18),
        newTrade.unit,
        ethers.parseUnits(newTrade.pricePerUnit, 18),
        newTrade.paymentToken,
        newTrade.incoterms,
        parseInt(newTrade.shipmentId),
        expiryTimestamp,
        disputeWindowDuration,
        depositAmount
      );
      await tx.wait();
      setMessage('Trade created successfully!');
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

  const handleAcceptTrade = async (tradeId: number) => {
    try {
      const domain = {
        name: "TradeManager",
        version: "1",
        chainId: (await tradeManager.runner.provider.getNetwork()).chainId,
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

      const signature = await (window as any).ethereum.request({
        method: "eth_signTypedData_v4",
        params: [account, JSON.stringify({ domain, types, value })],
      });

      const tx = await tradeManager.acceptTrade(tradeId, signature);
      await tx.wait();
      setMessage('Trade accepted successfully!');
    } catch (error: any) {
      console.error('Error accepting trade:', error);
      setMessage(`Error: ${error.message || 'Failed to accept trade'}`);
    }
  };

  const handleFundEscrow = async (tradeId: number, amount: string) => {
    try {
      // First approve the token spending
      const tx1 = await mockToken.approve(
        await escrowPayments.getAddress(),
        ethers.parseUnits(amount, 18)
      );
      await tx1.wait();

      // Then fund the escrow
      const tx2 = await escrowPayments.fundEscrow(
        tradeId,
        ethers.parseUnits(amount, 18)
      );
      await tx2.wait();
      setMessage('Escrow funded successfully!');
    } catch (error: any) {
      console.error('Error funding escrow:', error);
      setMessage(`Error: ${error.message || 'Failed to fund escrow'}`);
    }
  };

  const handleReleasePayment = async (tradeId: number) => {
    try {
      const tx = await escrowPayments.releasePayment(tradeId);
      await tx.wait();
      setMessage('Payment released successfully!');
    } catch (error: any) {
      console.error('Error releasing payment:', error);
      setMessage(`Error: ${error.message || 'Failed to release payment'}`);
    }
  };

  return (
    <div className="trade-management">
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
          <label>Payment Token Address:</label>
          <input
            type="text"
            value={newTrade.paymentToken}
            onChange={(e) => setNewTrade({ ...newTrade, paymentToken: e.target.value })}
            required
          />
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

      <h2>Your Trades</h2>
      <div className="trades-list">
        {/* This would be populated with actual trades */}
        <p>No trades found.</p>
      </div>

      {message && <p className="message">{message}</p>}
    </div>
  );
};

export default TradeManagement;