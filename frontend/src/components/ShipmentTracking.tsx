import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Shipment, StatusUpdate, Checkpoint } from '../types';

interface FundedTrade {
  id: number;
  buyer: string;
  seller: string;
  commodityType: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  depositAmount: string;
  escrowAmount: string;
  status: number;
}

interface ShipmentTrackingProps {
  shipmentTracker: any;
  tradeManager: any;
  escrowPayments: any;
  account: string;
}

const ShipmentTracking: React.FC<ShipmentTrackingProps> = ({
  shipmentTracker,
  tradeManager,
  escrowPayments,
  account
}) => {
  const [fundedTrades, setFundedTrades] = useState<FundedTrade[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [newShipment, setNewShipment] = useState({
    commodityType: '',
    quantity: '',
    unit: 'tons',
    origin: '',
    destination: '',
    shipper: '',
    expectedDeliveryDate: '',
    trackingId: '',
    linkedTradeId: ''
  });
  const [shipmentId, setShipmentId] = useState<number | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [userShipments, setUserShipments] = useState<Shipment[]>([]);
  const [loadingUserShipments, setLoadingUserShipments] = useState(false);

  // Fetch all trades with funded escrows
  const fetchFundedTrades = async () => {
    if (!tradeManager || !escrowPayments || !account) return;
    setLoadingTrades(true);

    try {
      const funded: FundedTrade[] = [];
      let currentId = 1;

      while (true) {
        try {
          const trade = await tradeManager.getTrade(currentId);
          if (!trade || trade.id.toString() === "0") break;

          // Check if user is party to this trade
          const isBuyer = trade.buyer.toLowerCase() === account.toLowerCase();
          const isSeller = trade.seller.toLowerCase() === account.toLowerCase();

          if (isBuyer || isSeller) {
            // Check escrow status for this trade
            try {
              const escrow = await escrowPayments.getEscrow(currentId);
              const escrowAmount = escrow.totalAmount;

              // Trade has funded escrow if escrow exists and has funds
              if (escrow.tradeId.toString() !== "0" && escrowAmount.toString() !== "0") {
                funded.push({
                  id: Number(trade.id),
                  buyer: trade.buyer,
                  seller: trade.seller,
                  commodityType: trade.commodityType,
                  quantity: ethers.formatUnits(trade.quantity, 18),
                  unit: trade.unit,
                  pricePerUnit: ethers.formatUnits(trade.pricePerUnit, 18),
                  depositAmount: ethers.formatUnits(trade.depositAmount, 18),
                  escrowAmount: ethers.formatUnits(escrowAmount, 18),
                  status: Number(trade.status)
                });
              }
            } catch {
              // No escrow for this trade - skip
            }
          }
          currentId++;
        } catch {
          break;
        }
      }

      setFundedTrades(funded);
    } catch (error) {
      console.error("Error fetching funded trades:", error);
    } finally {
      setLoadingTrades(false);
    }
  };

  const fetchUserShipments = async () => {
    if (!shipmentTracker || !account) return;
    setLoadingUserShipments(true);

    try {
      const shipments: Shipment[] = [];
      let currentId = 1;
      while (true) {
        try {
          const sh = await shipmentTracker.getShipment(currentId);
          if (!sh || sh.id.toString() === "0") break;

          if (
            sh.creator.toLowerCase() === account.toLowerCase() ||
            sh.shipper.toLowerCase() === account.toLowerCase()
          ) {
            shipments.push({
              id: Number(sh.id),
              creator: sh.creator,
              commodityType: sh.commodityType,
              quantity: ethers.formatUnits(sh.quantity, 18),
              unit: sh.unit,
              origin: sh.origin,
              destination: sh.destination,
              shipper: sh.shipper,
              expectedDeliveryDate: Number(sh.expectedDeliveryDate),
              trackingId: sh.trackingId,
              status: Number(sh.status),
              createdAt: Number(sh.createdAt)
            } as Shipment);
          }
          currentId++;
        } catch {
          break;
        }
      }
      setUserShipments(shipments.reverse());
    } catch (e) {
      console.error("Error fetching user shipments:", e);
    } finally {
      setLoadingUserShipments(false);
    }
  };

  useEffect(() => {
    fetchFundedTrades();
    fetchUserShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeManager, escrowPayments, shipmentTracker, account]);

  // Pre-fill shipment form from a funded trade
  const handleCreateShipmentFromTrade = (trade: FundedTrade) => {
    setNewShipment({
      commodityType: trade.commodityType,
      quantity: trade.quantity,
      unit: trade.unit,
      origin: '',
      destination: '',
      shipper: account,
      expectedDeliveryDate: '',
      trackingId: `TRADE-${trade.id}-${Date.now()}`,
      linkedTradeId: trade.id.toString()
    });
    setMessage(`Shipment form pre-filled from Trade #${trade.id}. Complete the remaining fields and submit.`);
    // Scroll to form
    document.getElementById('shipment-form')?.scrollIntoView({ behavior: 'smooth' });
  };

  const createShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      if (newShipment.linkedTradeId) {
        const trade = fundedTrades.find((t: any) => t.id.toString() === newShipment.linkedTradeId);
        if (trade) {
          const shipQty = parseFloat(newShipment.quantity);
          const tradeQty = parseFloat(trade.quantity);
          if (shipQty > tradeQty) {
            setMessage(`Error: Shipment quantity (${shipQty}) cannot exceed Trade quantity (${tradeQty})`);
            setLoading(false);
            return;
          }
        }
      }

      // Set to 23:59:59 of the selected date so it doesn't default to midnight (which might be in the past)
      const deliveryDateTarget = new Date(newShipment.expectedDeliveryDate);
      deliveryDateTarget.setHours(23, 59, 59, 999);
      const expectedDeliveryDate = Math.floor(deliveryDateTarget.getTime() / 1000);

      const tx = await shipmentTracker.createShipment(
        newShipment.commodityType,
        ethers.parseUnits(newShipment.quantity, 18),
        newShipment.unit,
        newShipment.origin,
        newShipment.destination,
        ethers.getAddress(newShipment.shipper),
        expectedDeliveryDate,
        newShipment.trackingId
      );
      const receipt = await tx.wait();

      // Extract shipment ID from event safely
      const event = receipt?.logs.find((log: any) =>
        log.fragment?.name === 'ShipmentCreated'
      );

      // If event parsing fails, default to a fallback message or fetch latest ID
      const newShipmentId = event?.args?.shipmentId;

      if (newShipmentId) {
        setMessage(`Shipment created successfully! ID: ${newShipmentId}${newShipment.linkedTradeId ? ` (linked to Trade #${newShipment.linkedTradeId})` : ''}`);
        setShipmentId(Number(newShipmentId));
      } else {
        setMessage(`Shipment created successfully! (Please refresh to see the new shipment)`);
      }

      fetchUserShipments();

      setNewShipment({
        commodityType: '',
        quantity: '',
        unit: 'tons',
        origin: '',
        destination: '',
        shipper: '',
        expectedDeliveryDate: '',
        trackingId: '',
        linkedTradeId: ''
      });
    } catch (error: any) {
      console.error('Error creating shipment:', error);
      setMessage(`Error: ${error.message || 'Failed to create shipment'}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchShipmentDetails = async () => {
    if (!shipmentId) return;

    try {
      const shipmentData = await shipmentTracker.getShipment(shipmentId);
      setShipment({
        id: Number(shipmentData.id),
        creator: shipmentData.creator,
        commodityType: shipmentData.commodityType,
        quantity: ethers.formatUnits(shipmentData.quantity, 18),
        unit: shipmentData.unit,
        origin: shipmentData.origin,
        destination: shipmentData.destination,
        shipper: shipmentData.shipper,
        expectedDeliveryDate: Number(shipmentData.expectedDeliveryDate),
        trackingId: shipmentData.trackingId,
        status: Number(shipmentData.status),
        createdAt: Number(shipmentData.createdAt)
      });

      // Fetch status updates
      const updates = await shipmentTracker.getStatusUpdates(shipmentId);
      setStatusUpdates(updates.map((u: any) => ({
        ...u,
        status: Number(u.status),
        timestamp: Number(u.timestamp)
      })));

      // Fetch checkpoints
      const cp = await shipmentTracker.getCheckpoints(shipmentId);
      setCheckpoints(cp.map((c: any) => ({
        ...c,
        temperature: Number(c.temperature),
        humidity: Number(c.humidity),
        timestamp: Number(c.timestamp)
      })));
    } catch (error) {
      console.error('Error fetching shipment details:', error);
    }
  };

  useEffect(() => {
    if (shipmentId !== null) {
      fetchShipmentDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  const tradeStatusLabel = (status: number) =>
    ['CREATED', 'ACCEPTED', 'LOCKED', 'EXECUTED', 'CLOSED', 'CANCELLED', 'DISPUTED'][status] || 'UNKNOWN';

  return (
    <div className="shipment-tracking">

      {/* ── Funded Trades Section ── */}
      <div style={{ marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 style={{ margin: 0 }}>📦 Escrow-Funded Trades</h2>
          <button
            onClick={fetchFundedTrades}
            disabled={loadingTrades}
            style={{ padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {loadingTrades ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loadingTrades ? (
          <p>Loading funded trades...</p>
        ) : fundedTrades.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No escrow-funded trades found. Fund a trade's escrow first from Trade Management.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {fundedTrades.map((trade) => (
              <div
                key={trade.id}
                style={{
                  border: '1px solid #4CAF50',
                  borderLeft: '4px solid #4CAF50',
                  padding: '15px',
                  borderRadius: '8px',
                  backgroundColor: '#f9fff9',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 8px 0' }}>Trade #{trade.id} — {trade.commodityType}</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '14px' }}>
                      <p style={{ margin: '2px 0' }}><strong>Quantity:</strong> {trade.quantity} {trade.unit}</p>
                      <p style={{ margin: '2px 0' }}><strong>Price/Unit:</strong> {trade.pricePerUnit} tUSD</p>
                      <p style={{ margin: '2px 0' }}><strong>Escrow Funded:</strong> <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>{parseFloat(trade.escrowAmount).toLocaleString()} tUSD</span></p>
                      <p style={{ margin: '2px 0' }}><strong>Status:</strong> {tradeStatusLabel(trade.status)}</p>
                      <p style={{ margin: '2px 0' }}><strong>Buyer:</strong> {trade.buyer.slice(0, 6)}...{trade.buyer.slice(-4)}</p>
                      <p style={{ margin: '2px 0' }}><strong>Seller:</strong> {trade.seller.slice(0, 6)}...{trade.seller.slice(-4)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCreateShipmentFromTrade(trade)}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      fontSize: '14px'
                    }}
                  >
                    🚚 Create Shipment
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Your Created Shipments Section ── */}
      <div style={{ marginBottom: '30px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h2 style={{ margin: 0 }}>📍 Your Created Shipments</h2>
          <button
            onClick={fetchUserShipments}
            disabled={loadingUserShipments}
            style={{ padding: '8px 16px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {loadingUserShipments ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {loadingUserShipments ? (
          <p>Loading your shipments...</p>
        ) : userShipments.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>You have no shipments.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
            {userShipments.map((shipment) => (
              <div
                key={shipment.id}
                onClick={() => setShipmentId(shipment.id)}
                style={{
                  border: '1px solid #ddd',
                  padding: '15px',
                  borderRadius: '8px',
                  backgroundColor: shipmentId === shipment.id ? '#eaf4ff' : '#fff',
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                  transition: 'transform 0.2s',
                }}
              >
                <h3 style={{ marginTop: 0 }}>Shipment #{shipment.id}</h3>
                <p style={{ margin: '4px 0' }}><strong>Commodity:</strong> {shipment.commodityType}</p>
                <p style={{ margin: '4px 0' }}><strong>Route:</strong> {shipment.origin} ➔ {shipment.destination}</p>
                <p style={{ margin: '4px 0' }}><strong>Status:</strong> {
                  ['CREATED', 'PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'DELIVERED', 'CANCELLED', 'DISPUTED'][shipment.status]
                }</p>
                <p style={{ margin: '4px 0', fontSize: '12px', color: '#666' }}>ID: {shipment.trackingId}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <hr style={{ margin: '30px 0', border: 'none', borderTop: '1px solid #eee' }} />

      {/* ── Create Shipment Form ── */}
      <h2 id="shipment-form">Create Shipment</h2>
      {newShipment.linkedTradeId && (
        <div style={{ background: '#e3f2fd', border: '1px solid #2196F3', borderRadius: '6px', padding: '10px 16px', marginBottom: '16px', fontSize: '14px' }}>
          📋 <strong>Linked to Trade #{newShipment.linkedTradeId}</strong> — Commodity and quantity have been pre-filled.
        </div>
      )}
      <form onSubmit={createShipment}>
        <div>
          <label>Commodity Type:</label>
          <input
            type="text"
            value={newShipment.commodityType}
            onChange={(e) => setNewShipment({ ...newShipment, commodityType: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Quantity:</label>
          <input
            type="number"
            value={newShipment.quantity}
            onChange={(e) => setNewShipment({ ...newShipment, quantity: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Unit:</label>
          <select
            value={newShipment.unit}
            onChange={(e) => setNewShipment({ ...newShipment, unit: e.target.value })}
          >
            <option value="tons">Tons</option>
            <option value="kg">Kilograms</option>
            <option value="lbs">Pounds</option>
          </select>
        </div>
        <div>
          <label>Origin:</label>
          <input
            type="text"
            value={newShipment.origin}
            onChange={(e) => setNewShipment({ ...newShipment, origin: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Destination:</label>
          <input
            type="text"
            value={newShipment.destination}
            onChange={(e) => setNewShipment({ ...newShipment, destination: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Shipper Address:</label>
          <input
            type="text"
            value={newShipment.shipper}
            onChange={(e) => setNewShipment({ ...newShipment, shipper: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Expected Delivery Date:</label>
          <input
            type="date"
            value={newShipment.expectedDeliveryDate}
            onChange={(e) => setNewShipment({ ...newShipment, expectedDeliveryDate: e.target.value })}
            required
          />
        </div>
        <div>
          <label>Tracking ID:</label>
          <input
            type="text"
            value={newShipment.trackingId}
            onChange={(e) => setNewShipment({ ...newShipment, trackingId: e.target.value })}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Shipment'}
        </button>
      </form>

      {shipmentId && (
        <div className="shipment-details">
          <h3>Shipment Details (ID: {shipmentId})</h3>
          {shipment && (
            <div>
              <p><strong>Commodity:</strong> {shipment.commodityType} ({shipment.quantity} {shipment.unit})</p>
              <p><strong>Route:</strong> {shipment.origin} → {shipment.destination}</p>
              <p><strong>Shipper:</strong> {shipment.shipper}</p>
              <p><strong>Status:</strong> {['Created', 'Picked Up', 'In Transit', 'Customs', 'Delivered', 'Disputed', 'Cancelled'][shipment.status]}</p>
              <p><strong>Expected Delivery:</strong> {new Date(shipment.expectedDeliveryDate * 1000).toLocaleDateString()}</p>
            </div>
          )}

          <h4>Status Updates</h4>
          <ul>
            {statusUpdates.length > 0 ? (
              statusUpdates.map((update, index) => (
                <li key={index}>
                  <strong>{['Created', 'Picked Up', 'In Transit', 'Customs', 'Delivered', 'Disputed', 'Cancelled'][update.status]}</strong>:
                  {update.details} at {new Date(update.timestamp * 1000).toLocaleString()}
                </li>
              ))
            ) : (
              <li>No status updates yet</li>
            )}
          </ul>

          <h4>Checkpoints</h4>
          <ul>
            {checkpoints.length > 0 ? (
              checkpoints.map((cp, index) => (
                <li key={index}>
                  <strong>{cp.location}</strong>: Temp {cp.temperature}°C, Humidity {cp.humidity}% at {new Date(cp.timestamp * 1000).toLocaleString()}
                </li>
              ))
            ) : (
              <li>No checkpoints recorded</li>
            )}
          </ul>
        </div>
      )}

      {message && <p className="message">{message}</p>}
    </div>
  );
};

export default ShipmentTracking;