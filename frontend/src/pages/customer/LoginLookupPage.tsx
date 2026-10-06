import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Phone, ArrowRight, ArrowLeft, UserCheck, Sparkles, RefreshCw, Scissors, 
  User, Lock, Search, Store, LogOut, ShieldCheck, ChevronRight, UserPlus 
} from 'lucide-react';
import { lookupCustomer, createCustomer, salonLogin, getCustomers } from '../../api/client';

export const LoginLookupPage: React.FC = () => {
  const navigate = useNavigate();
  
  // Tab control: 'customer' | 'salon'
  const [activeTab, setActiveTab] = useState<'customer' | 'salon'>('customer');

  // Customer Login State
  const [phoneNumber, setPhoneNumber] = useState('9876500001');
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female'>('Male');
  const [loading, setLoading] = useState(false);
  const [customerResult, setCustomerResult] = useState<any>(null);

  // Salon Staff Login State
  const [username, setUsername] = useState('stylist');
  const [password, setPassword] = useState('stylist123');
  const [salonUser, setSalonUser] = useState<any>(() => {
    const saved = localStorage.getItem('salon_staff_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [salonLoading, setSalonLoading] = useState(false);
  const [salonError, setSalonError] = useState<string | null>(null);

  // Salon Customer Directory & Selected Customer State
  const [customersList, setCustomersList] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedSalonCustomer, setSelectedSalonCustomer] = useState<any | null>(null);

  // Fetch customers whenever salon staff is logged in or search query changes
  useEffect(() => {
    if (activeTab === 'salon' && salonUser) {
      loadSalonCustomers(searchQuery);
    }
  }, [activeTab, salonUser, searchQuery]);

  const loadSalonCustomers = async (queryStr: string) => {
    setLoadingCustomers(true);
    try {
      const data = await getCustomers(queryStr);
      setCustomersList(data);
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoadingCustomers(false);
    }
  };

  // --- CUSTOMER LOGIN HANDLERS ---
  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) return;
    setLoading(true);
    try {
      const res = await lookupCustomer(phoneNumber);
      setCustomerResult(res);
      if (!res.found) {
        setFullName('');
      } else {
        localStorage.setItem('salon_customer_id', String(res.customer.id));
        localStorage.setItem('salon_customer_name', res.customer.full_name);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNewCustomer = async () => {
    if (!fullName || !phoneNumber) return;
    setLoading(true);
    try {
      const referralCode = localStorage.getItem('salon_referral_code') || undefined;
      const newCust = await createCustomer({ full_name: fullName, phone_number: phoneNumber, referral_code: referralCode });
      localStorage.removeItem('salon_referral_code');
      localStorage.setItem('salon_customer_id', String(newCust.id));
      localStorage.setItem('salon_customer_name', newCust.full_name);
      navigate('/customer/photo');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleContinuePreviousStyle = () => {
    navigate('/customer/instructions');
  };

  const handleGenerateNewStyle = () => {
    navigate('/customer/photo');
  };

  // --- SALON LOGIN & SELECTION HANDLERS ---
  const handleSalonLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setSalonLoading(true);
    setSalonError(null);
    try {
      const res = await salonLogin(username, password);
      const userObj = { full_name: res.full_name, role: res.role, token: res.access_token };
      setSalonUser(userObj);
      localStorage.setItem('salon_staff_user', JSON.stringify(userObj));
      loadSalonCustomers('');
    } catch (err: any) {
      setSalonError(err.message || 'Login failed. Please check username and password.');
    } finally {
      setSalonLoading(false);
    }
  };

  const handleSalonLogout = () => {
    setSalonUser(null);
    setSelectedSalonCustomer(null);
    localStorage.removeItem('salon_staff_user');
  };

  const handleSelectCustomerCard = (customer: any) => {
    setSelectedSalonCustomer(customer);
  };

  const handleSalonContinuePreviousStyle = (customer: any) => {
    localStorage.setItem('salon_customer_id', String(customer.id));
    localStorage.setItem('salon_customer_name', customer.full_name);
    navigate('/customer/instructions');
  };

  const handleSalonGenerateNewStyle = (customer: any) => {
    localStorage.setItem('salon_customer_id', String(customer.id));
    localStorage.setItem('salon_customer_name', customer.full_name);
    navigate('/customer/photo');
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-6 px-4">
      {/* Top Main Container */}
      <div className={`w-full transition-all duration-300 ${activeTab === 'salon' && salonUser ? 'max-w-4xl' : 'max-w-lg'}`}>
        
        {/* Dual Login Navigation Tabs */}
        <div className="bg-slate-900/90 p-1.5 rounded-2xl border border-slate-700/80 shadow-xl mb-6 flex space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('customer')}
            className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center space-x-2 ${
              activeTab === 'customer'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <User className="w-4 h-4" />
            <span>Customer Login</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('salon')}
            className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center space-x-2 ${
              activeTab === 'salon'
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Store className="w-4 h-4" />
            <span>Salon Portal Login</span>
          </button>
        </div>

        {/* TAB 1: CUSTOMER LOGIN */}
        {activeTab === 'customer' && (
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
                <Scissors className="w-8 h-8" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Welcome to Salon AI</h2>
              <p className="text-slate-400 text-sm mt-1">Enter your mobile number to begin your personalized style session</p>
            </div>

            {!customerResult ? (
              <form onSubmit={handleLookup} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Mobile Number / Customer ID
                  </label>
                  <div className="relative">
                    <Phone className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="e.g. 9876500001"
                      className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-4 pl-12 pr-4 text-lg font-medium text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all touch-target-large"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold py-4 rounded-2xl text-lg shadow-lg shadow-amber-500/25 active:scale-[0.98] transition-all flex items-center justify-center space-x-2 touch-target-large"
                >
                  {loading ? (
                    <RefreshCw className="w-6 h-6 animate-spin text-slate-950" />
                  ) : (
                    <>
                      <span>Find Customer Profile</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </form>
            ) : customerResult.found ? (
              /* RETURNING CUSTOMER FOUND */
              <div className="space-y-6">
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-xl">
                    {customerResult.customer.full_name[0]}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white">{customerResult.customer.full_name}</h3>
                    <p className="text-xs text-amber-400 font-semibold">
                      {customerResult.customer.customer_code} • {customerResult.customer.segment_name} • {customerResult.customer.total_visits} Visits
                    </p>
                  </div>
                </div>

                {customerResult.customer.previous_style?.reference_image_url && (
                  <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/50">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your Previous Hairstyle</p>
                    <div className="relative mx-auto h-72 sm:h-80 aspect-[4/5] max-w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/60">
                      <img
                        src={customerResult.customer.previous_style.reference_image_url}
                        alt="Previous Style"
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent flex items-end p-3">
                        <span className="text-xs font-bold text-amber-300">
                          {customerResult.customer.previous_style?.hairstyle_name || 'Previous Selected Hairstyle'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    onClick={handleContinuePreviousStyle}
                    className="p-4 rounded-2xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold text-center flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 transition-all"
                  >
                    <UserCheck className="w-6 h-6 text-amber-400" />
                    <span>Continue Previous Style</span>
                  </button>

                  <button
                    onClick={handleGenerateNewStyle}
                    className="p-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-center flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 transition-all shadow-lg shadow-amber-500/20"
                  >
                    <Sparkles className="w-6 h-6 text-slate-950" />
                    <span>Generate New Style</span>
                  </button>
                </div>
              </div>
            ) : (
              /* NEW CUSTOMER FORM */
              <div className="space-y-5">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-700 text-xs text-amber-400 font-medium">
                  New customer record detected. Please enter your details below.
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ananya Sharma or Rahul Patel"
                    className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-3.5 px-4 text-white text-base focus:outline-none touch-target-large"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Salon Portal Category (Gender)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setGender('Male')}
                      className={`p-3.5 rounded-2xl border font-bold text-sm touch-target-large transition-all ${
                        gender === 'Male'
                          ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-md shadow-amber-500/20'
                          : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                    >
                      Men's Salon
                    </button>
                    <button
                      type="button"
                      onClick={() => setGender('Female')}
                      className={`p-3.5 rounded-2xl border font-bold text-sm touch-target-large transition-all ${
                        gender === 'Female'
                          ? 'bg-purple-500 text-white border-purple-500 shadow-md shadow-purple-500/20'
                          : 'bg-slate-900 border-slate-700 text-slate-300'
                      }`}
                    >
                      Women's Salon
                    </button>
                  </div>
                </div>

                <button
                  onClick={handleCreateNewCustomer}
                  disabled={loading || !fullName}
                  className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-4 rounded-2xl text-base shadow-lg active:scale-95 transition-all touch-target-large"
                >
                  Register & Take Photo
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SALON PORTAL LOGIN & CUSTOMER SELECTION */}
        {activeTab === 'salon' && (
          <div>
            {!salonUser ? (
              /* SALON LOGIN FORM */
              <div className="bg-slate-800/80 border border-slate-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl max-w-lg mx-auto">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
                    <ShieldCheck className="w-8 h-8" />
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Salon Staff Portal</h2>
                  <p className="text-slate-400 text-sm mt-1">Login with your salon username & password to manage customer AI consultations</p>
                </div>

                {salonError && (
                  <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-medium">
                    {salonError}
                  </div>
                )}

                <form onSubmit={handleSalonLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Username</label>
                    <div className="relative">
                      <User className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="e.g. stylist or admin"
                        className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-3.5 pl-12 pr-4 text-white focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Password</label>
                    <div className="relative">
                      <Lock className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-3.5 pl-12 pr-4 text-white focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  {/* Quick Preset Credentials Chips */}
                  <div className="flex items-center space-x-2 pt-1">
                    <span className="text-xs text-slate-400">Quick Fill:</span>
                    <button
                      type="button"
                      onClick={() => { setUsername('stylist'); setPassword('stylist123'); }}
                      className="px-2.5 py-1 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-xs text-amber-300 border border-slate-600"
                    >
                      Stylist
                    </button>
                    <button
                      type="button"
                      onClick={() => { setUsername('admin'); setPassword('admin123'); }}
                      className="px-2.5 py-1 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-xs text-amber-300 border border-slate-600"
                    >
                      Admin
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={salonLoading}
                    className="w-full mt-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold py-4 rounded-2xl text-lg shadow-lg shadow-amber-500/25 active:scale-[0.98] transition-all flex items-center justify-center space-x-2"
                  >
                    {salonLoading ? (
                      <RefreshCw className="w-6 h-6 animate-spin text-slate-950" />
                    ) : (
                      <>
                        <span>Login to Salon Portal</span>
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            ) : selectedSalonCustomer ? (
              /* SELECTED CUSTOMER PROFILE VIEW FOR SALON STAFF */
              <div className="bg-slate-800/90 border border-slate-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl max-w-xl mx-auto space-y-6">
                <button
                  type="button"
                  onClick={() => setSelectedSalonCustomer(null)}
                  className="flex items-center space-x-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back to Customer Directory</span>
                </button>

                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center space-x-4">
                  <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-800 border border-amber-500/30 flex-shrink-0 flex items-center justify-center text-white font-bold text-xl">
                    {selectedSalonCustomer.avatar_url ? (
                      <img
                        src={selectedSalonCustomer.avatar_url}
                        alt={selectedSalonCustomer.full_name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-amber-400 font-bold">{selectedSalonCustomer.full_name[0]}</span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white flex items-center space-x-2">
                      <span>{selectedSalonCustomer.full_name}</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-amber-300">
                        {selectedSalonCustomer.customer_code}
                      </span>
                    </h3>
                    <p className="text-xs text-amber-400 font-semibold mt-0.5">
                      {selectedSalonCustomer.segment_name} • {selectedSalonCustomer.total_visits} Visits
                    </p>
                  </div>
                </div>

                {selectedSalonCustomer.previous_style?.reference_image_url && (
                  <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700/50">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Previous Selected Hairstyle</p>
                    <div className="relative mx-auto h-72 sm:h-80 aspect-[4/5] max-w-full rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/60">
                      <img
                        src={selectedSalonCustomer.previous_style.reference_image_url}
                        alt="Previous Style"
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent flex items-end p-3">
                        <span className="text-xs font-bold text-amber-300">
                          {selectedSalonCustomer.previous_style?.hairstyle_name || 'Previous Selected Hairstyle'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => handleSalonContinuePreviousStyle(selectedSalonCustomer)}
                    className="p-4 rounded-2xl bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white font-bold text-center flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 transition-all"
                  >
                    <UserCheck className="w-6 h-6 text-amber-400" />
                    <span>Continue Previous Style</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSalonGenerateNewStyle(selectedSalonCustomer)}
                    className="p-4 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-center flex flex-col items-center justify-center space-y-2 touch-target-large active:scale-95 transition-all shadow-lg shadow-amber-500/20"
                  >
                    <Sparkles className="w-6 h-6 text-slate-950" />
                    <span>Generate New Style</span>
                  </button>
                </div>
              </div>
            ) : (
              /* LOGGED-IN SALON STAFF: CUSTOMER LIST & SEARCH PANEL */
              <div className="bg-slate-800/90 border border-slate-700/70 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
                {/* Header with Salon Staff info & Logout */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-700/60 gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 flex items-center justify-center font-bold text-xl">
                      <Scissors className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                        <span>{salonUser.full_name || 'Salon Staff'}</span>
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
                          {salonUser.role || 'Stylist'}
                        </span>
                      </h2>
                      <p className="text-xs text-slate-400">Select a customer from the list below to view profile options</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSalonLogout}
                    className="self-start sm:self-auto px-4 py-2 rounded-xl bg-slate-700/70 hover:bg-slate-700 border border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center space-x-1.5 transition-all"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </div>

                {/* Real-time Customer Search Input */}
                <div className="mb-6">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Search Customer Directory
                  </label>
                  <div className="relative">
                    <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by name, mobile number or customer ID (e.g. CUST-62FB61)..."
                      className="w-full bg-slate-900 border border-slate-700 focus:border-amber-500 rounded-2xl py-3.5 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-base"
                    />
                  </div>
                </div>

                {/* Customers Grid */}
                {loadingCustomers ? (
                  <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                    <RefreshCw className="w-8 h-8 animate-spin text-amber-500" />
                    <span>Loading customer directory...</span>
                  </div>
                ) : customersList.length === 0 ? (
                  <div className="py-12 text-center bg-slate-900/60 rounded-2xl border border-slate-700/50 p-6">
                    <UserPlus className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                    <p className="text-white font-bold">No customers found</p>
                    <p className="text-xs text-slate-400 mt-1">Try searching with a different mobile number, customer ID, or name.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customersList.map((customer) => (
                      <div
                        key={customer.id}
                        onClick={() => handleSelectCustomerCard(customer)}
                        className="p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-700/70 hover:border-amber-500/60 transition-all cursor-pointer group flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3.5 min-w-0">
                          {/* Customer Image / Avatar */}
                          <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 flex-shrink-0 flex items-center justify-center text-white font-bold text-xl">
                            {customer.avatar_url ? (
                              <img
                                src={customer.avatar_url}
                                alt={customer.full_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-amber-400 font-bold">{customer.full_name[0]}</span>
                            )}
                          </div>

                          {/* Details */}
                          <div className="min-w-0">
                            <div className="flex items-center space-x-2">
                              <h3 className="font-bold text-white text-base truncate group-hover:text-amber-400 transition-colors">
                                {customer.full_name}
                              </h3>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300 flex-shrink-0">
                                {customer.customer_code}
                              </span>
                            </div>

                            {/* Phone numbers are not shown to staff; only say when the search matched one */}
                            {customer.matched_by_phone && (
                              <p className="text-xs text-emerald-400 flex items-center space-x-1 mt-1">
                                <Phone className="w-3 h-3" />
                                <span>Matched mobile number</span>
                              </p>
                            )}

                            <p className="text-[11px] text-slate-500 mt-1">
                              {customer.segment_name} • {customer.total_visits} Visits
                            </p>
                          </div>
                        </div>

                        {/* Action Button */}
                        <div className="flex-shrink-0 ml-3">
                          <button
                            type="button"
                            className="p-3 rounded-xl bg-amber-500/10 group-hover:bg-amber-500 text-amber-400 group-hover:text-slate-950 font-bold transition-all flex items-center space-x-1 text-xs"
                          >
                            <span className="hidden sm:inline">Select Profile</span>
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
