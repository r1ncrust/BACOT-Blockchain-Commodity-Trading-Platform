export interface Company {
  legalName: string;
  registrationId: string;
  country: string;
  contactEmail: string;
  walletAddress: string;
  role: number; // 0: BUYER, 1: SELLER, 2: BOTH
  status: number; // 0: PENDING, 1: APPROVED, 2: SUSPENDED
  createdAt: number;
}

export interface Trade {
  id: number;
  buyer: string;
  seller: string;
  commodityType: string;
  quantity: string;
  unit: string;
  pricePerUnit: string;
  paymentToken: string;
  incoterms: string;
  shipmentId: number;
  expiryTimestamp: number;
  disputeWindowEnds: number;
  depositAmount: string;
  status: number; // 0:CREATED, 1:ACCEPTED, 2:LOCKED, 3:EXECUTED, 4:CLOSED, 5:CANCELLED, 6:DISPUTED
  createdAt: number;
  buyerSignatureHash: string;
  sellerSignatureHash: string;
  finalConfirmationHash: string;
}

export interface Shipment {
  id: number;
  creator: string;
  commodityType: string;
  quantity: string;
  unit: string;
  origin: string;
  destination: string;
  shipper: string;
  expectedDeliveryDate: number;
  trackingId: string;
  status: number; // 0:CREATED, 1:PICKED_UP, 2:IN_TRANSIT, 3:CUSTOMS, 4:DELIVERED, 5:DISPUTED, 6:CANCELLED
  createdAt: number;
}

export interface StatusUpdate {
  status: number;
  details: string;
  timestamp: number;
  updater: string;
}

export interface Checkpoint {
  location: string;
  temperature: number;
  humidity: number;
  timestamp: number;
  dataHash: string;
}

export interface Escrow {
  tradeId: number;
  buyer: string;
  seller: string;
  paymentToken: string;
  totalAmount: string;
  releasedAmount: string;
  isReleased: boolean;
  isRefunded: boolean;
  disputeStartTime: number;
  inDispute: boolean;
}