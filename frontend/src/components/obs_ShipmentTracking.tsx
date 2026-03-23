import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Shipment, StatusUpdate, Checkpoint } from '../types';

interface ShipmentTrackingProps {
  shipmentTracker: any;
  account: string;
}

const ShipmentTracking: React.FC<ShipmentTrackingProps> = ({ shipmentTracker, account }) => {
  const [newShipment, setNewShipment] = useState({
    commodityType: '',
    quantity: '',
    unit: 'tons',
    origin: '',
    destination: '',
    shipper: '',
    expectedDeliveryDate: '',
    trackingId: ''
  });
  const [shipmentId, setShipmentId] = useState<number | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [statusUpdates, setStatusUpdates] = useState<StatusUpdate[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const createShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const expectedDeliveryDate = Math.floor(new Date(newShipment.expectedDeliveryDate).getTime() / 1000);
      
      const tx = await shipmentTracker.createShipment(
        newShipment.commodityType,
        ethers.parseUnits(newShipment.quantity, 18),
        newShipment.unit,
        newShipment.origin,
        newShipment.destination,
        newShipment.shipper,
        expectedDeliveryDate,
        newShipment.trackingId
      );
      const receipt = await tx.wait();
      
      // Extract shipment ID from event
      const event = receipt?.logs.find((log: any) => 
        log.fragment?.name === 'ShipmentCreated'
      );
      const newShipmentId = event.args.shipmentId;
      
      setMessage(`Shipment created successfully! ID: ${newShipmentId}`);
      setShipmentId(newShipmentId);
      
      setNewShipment({
        commodityType: '',
        quantity: '',
        unit: 'tons',
        origin: '',
        destination: '',
        shipper: '',
        expectedDeliveryDate: '',
        trackingId: ''
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
        ...shipmentData,
        id: Number(shipmentData.id),
        quantity: ethers.formatUnits(shipmentData.quantity, 18),
        expectedDeliveryDate: Number(shipmentData.expectedDeliveryDate),
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
  }, [shipmentId]);

  return (
    <div className="shipment-tracking">
      <h2>Create Shipment</h2>
      <form onSubmit={createShipment}>
        <div>
          <label>Commodity Type:</label>
          <input
            type="text"
            value={newShipment.commodityType}
            onChange={(e) => setNewShipment({...newShipment, commodityType: e.target.value})}
            required
          />
        </div>
        <div>
          <label>Quantity:</label>
          <input
            type="number"
            value={newShipment.quantity}
            onChange={(e) => setNewShipment({...newShipment, quantity: e.target.value})}
            required
          />
        </div>
        <div>
          <label>Unit:</label>
          <select
            value={newShipment.unit}
            onChange={(e) => setNewShipment({...newShipment, unit: e.target.value})}
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
            onChange={(e) => setNewShipment({...newShipment, origin: e.target.value})}
            required
          />
        </div>
        <div>
          <label>Destination:</label>
          <input
            type="text"
            value={newShipment.destination}
            onChange={(e) => setNewShipment({...newShipment, destination: e.target.value})}
            required
          />
        </div>
        <div>
          <label>Shipper:</label>
          <input
            type="text"
            value={newShipment.shipper}
            onChange={(e) => setNewShipment({...newShipment, shipper: e.target.value})}
            required
          />
        </div>
        <div>
          <label>Expected Delivery Date:</label>
          <input
            type="date"
            value={newShipment.expectedDeliveryDate}
            onChange={(e) => setNewShipment({...newShipment, expectedDeliveryDate: e.target.value})}
            required
          />
        </div>
        <div>
          <label>Tracking ID:</label>
          <input
            type="text"
            value={newShipment.trackingId}
            onChange={(e) => setNewShipment({...newShipment, trackingId: e.target.value})}
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