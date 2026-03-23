import React, { useState } from 'react';
import { ethers } from 'ethers';

interface CompanyOnboardingProps {
  companyRegistry: any;
  account: string;
}

const CompanyOnboarding: React.FC<CompanyOnboardingProps> = ({ companyRegistry, account }) => {
  const [formData, setFormData] = useState({
    legalName: '',
    registrationId: '',
    country: '',
    contactEmail: '',
    role: '0' // 0: BUYER, 1: SELLER, 2: BOTH
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const tx = await companyRegistry.registerCompany(
        formData.legalName,
        formData.registrationId,
        formData.country,
        formData.contactEmail,
        parseInt(formData.role)
      );
      await tx.wait();
      setMessage('Company registered successfully! Awaiting approval...');
    } catch (error: any) {
      console.error('Error registering company:', error);
      setMessage(`Error: ${error.message || 'Failed to register company'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="company-onboarding">
      <h2>Company Registration</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <label>Legal Name:</label>
          <input
            type="text"
            name="legalName"
            value={formData.legalName}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label>Registration ID:</label>
          <input
            type="text"
            name="registrationId"
            value={formData.registrationId}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label>Country:</label>
          <input
            type="text"
            name="country"
            value={formData.country}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label>Contact Email:</label>
          <input
            type="email"
            name="contactEmail"
            value={formData.contactEmail}
            onChange={handleChange}
            required
          />
        </div>
        <div>
          <label>Role:</label>
          <select
            name="role"
            value={formData.role}
            onChange={handleChange}
          >
            <option value="0">Buyer</option>
            <option value="1">Seller</option>
            <option value="2">Both</option>
          </select>
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Registering...' : 'Register Company'}
        </button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
};

export default CompanyOnboarding;