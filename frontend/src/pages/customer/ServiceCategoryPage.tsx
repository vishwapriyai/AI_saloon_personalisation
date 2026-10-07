import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Sparkles, User, ArrowRight, Palette, Check, Wind, AlertTriangle } from 'lucide-react';
import { getRecommendations, getLastPreferences } from '../../api/client';
import { currentCustomerId } from '../../auth/session';
import { HairAnalysisCard } from '../../components/HairAnalysisCard';

export const ServiceCategoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [selectedGender, setSelectedGender] = useState<'Women' | 'Men' | 'All'>('Women');
  const [selectedServices, setSelectedServices] = useState<string[]>(['Hair']);
  const [selectedCategory, setSelectedCategory] = useState<'Classic' | 'Trendy' | 'Professional'>('Trendy');
  const [loading, setLoading] = useState(false);
  const [fromLastVisit, setFromLastVisit] = useState(false);

  // Check if customer photo analysis indicates a bald or clean shaved scalp
  const photoAnalysis = (() => {
    try {
      return JSON.parse(localStorage.getItem('salon_photo_analysis') || 'null');
    } catch {
      return null;
    }
  })();
  const hairLen = String(photoAnalysis?.hair_length || '').toLowerCase();
  const hairDen = String(photoAnalysis?.hair_density || '').toLowerCase();
  const beardStyle = String(photoAnalysis?.beard_style_current || photoAnalysis?.beard_style || '').toLowerCase();
  const isCustomerBald = hairLen === 'bald' || hairDen.includes('bald') || hairDen.includes('sparse');
  const isCleanShaven = !beardStyle || beardStyle === 'clean shaven' || beardStyle === 'none' || beardStyle === 'unknown';

  // Returning customers: pre-select what they chose last time (they can still change it)
  useEffect(() => {
    const customerId = Number(localStorage.getItem('salon_customer_id') || 0);
    localStorage.removeItem('salon_last_hairstyle_id');
    if (!customerId) return;
    let active = true;
    getLastPreferences(customerId)
      .then((prefs) => {
        if (!active || !prefs) return;
        if (prefs.gender) setSelectedGender(prefs.gender);
        const known = prefs.target_services.filter((s) => services.some((svc) => svc.id === s));
        if (known.length) setSelectedServices(known);
        if (prefs.style_category) setSelectedCategory(prefs.style_category);
        if (prefs.hairstyle_id) localStorage.setItem('salon_last_hairstyle_id', String(prefs.hairstyle_id));
        setFromLastVisit(Boolean(prefs.gender || known.length || prefs.style_category));
      })
      .catch((err) => console.error('Could not load last preferences:', err));
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If customer is bald, auto-switch default to Beard if selecting haircut
  useEffect(() => {
    if (isCustomerBald && selectedGender !== 'Women' && selectedServices.includes('Hair') && !selectedServices.includes('Beard')) {
      setSelectedServices(['Beard']);
    }
  }, [isCustomerBald, selectedGender]);

  const collections = [
    { id: 'Women', title: "Women's Collection", desc: "Layers, bobs, curtain bangs, balayage & glossing" },
    { id: 'Men', title: "Men's Collection", desc: "Taper fades, crops, side parts & beard grooming" },
    { id: 'All', title: "All / Gender-Neutral", desc: "Full unisex haircut, texture & color catalogue" },
  ];

  const services = [
    { id: 'Hair', title: 'Haircut & Hairstyle', icon: Scissors, desc: 'Bobs, layers, fades, crops & tops' },
    { id: 'Colour / Balayage', title: 'Hair Colour', icon: Palette, desc: 'Highlights, balayage, glossing & roots' },
    { id: 'Keratin / Smoothening', title: 'Smoothening & Perms', icon: Wind, desc: 'Keratin treatment & texture perms' },
    { id: 'Beard', title: 'Beard & Grooming', icon: User, desc: 'Trimming, sculpting & beard lining' },
  ];

  const categories = [
    { id: 'Classic', title: 'Classic', desc: 'Timeless executive cuts, elegant bobs & clean aesthetics' },
    { id: 'Trendy', title: 'Trendy', desc: 'Curtain bangs, balayage waves, modern fades & textured crops' },
    { id: 'Professional', title: 'Professional', desc: 'Neat corporate lobs & business styling for work' },
  ];

  // Beard grooming is a men's service: not offered in the Women's collection
  const beardUnavailable = selectedGender === 'Women';
  useEffect(() => {
    if (beardUnavailable && selectedServices.includes('Beard')) {
      const rest = selectedServices.filter((s) => s !== 'Beard');
      setSelectedServices(rest.length ? rest : ['Hair']);
    }
  }, [beardUnavailable, selectedServices]);

  const toggleService = (serviceId: string) => {
    if (serviceId === 'Beard' && beardUnavailable) return;
    if (selectedServices.includes(serviceId)) {
      if (selectedServices.length > 1) {
        setSelectedServices(selectedServices.filter((s) => s !== serviceId));
      }
    } else {
      setSelectedServices([...selectedServices, serviceId]);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    const customerId = currentCustomerId();
    const photoId = Number(localStorage.getItem('salon_photo_id') || 0);

    try {
      const rec = await getRecommendations({
        customer_id: customerId,
        photo_id: photoId,
        target_service_type: selectedServices.join(', '),
        style_category: selectedCategory,
        gender: selectedGender,
      });

      localStorage.setItem('salon_recommendation_id', String(rec.recommendation_id));
      localStorage.setItem('salon_recommended_styles', JSON.stringify(rec.recommended_styles));
      navigate('/customer/generate');
    } catch (err) {
      console.error(err);
      navigate('/customer/generate');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-4 sm:py-6">
      <div className="w-full space-y-6">
        <div className="text-center">
          <span className="text-xs px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 font-semibold border border-amber-500/30">
            STEP 2 OF 4: STYLE PREFERENCES
          </span>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mt-2">Choose Collection & Look</h2>
          {fromLastVisit && (
            <p className="text-xs text-amber-300 mt-2">Pre-selected from your last visit. Tap any option to change it.</p>
          )}
        </div>

        <HairAnalysisCard showBeard={selectedGender !== 'Women'} />

        {isCustomerBald && (
          <div className="bg-amber-500/15 border border-amber-500/40 p-4 rounded-2xl flex items-start space-x-3 text-amber-200 text-xs sm:text-sm shadow-sm">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-amber-300 block">Notice: Clean Shaved / Bald Scalp Detected</span>
              <p className="text-slate-300 leading-relaxed">
                We don't have hair-based haircut services for you because your photo analysis shows a bald or clean shaved scalp. Haircut services are only for customers with hair. Please select <b>Beard & Grooming</b> service instead.
              </p>
            </div>
          </div>
        )}

        {isCleanShaven && selectedServices.includes('Beard') && !isCustomerBald && (
          <div className="bg-amber-500/15 border border-amber-500/40 p-4 rounded-2xl flex items-start space-x-3 text-amber-200 text-xs sm:text-sm shadow-sm">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-amber-300 block">Notice: Clean-Shaven Face Detected</span>
              <p className="text-slate-300 leading-relaxed">
                We cannot generate a beard for a non-bearded person. Beard trimming & sculpting services require existing facial hair growth. For clean-shaven faces, Clean Shave or facial skin care services apply.
              </p>
            </div>
          </div>
        )}

        {/* Style Collection Selection (Women's / Men's / All) */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">1. Select Style Collection</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {collections.map((col) => {
              const isSelected = selectedGender === col.id;
              return (
                <button
                  key={col.id}
                  onClick={() => setSelectedGender(col.id as any)}
                  className={`p-4 rounded-2xl text-left border transition-all touch-target-large active:scale-95 ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500 text-white ring-2 ring-amber-500/30 shadow-sm'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <h4 className="font-bold text-sm text-amber-400">{col.title}</h4>
                  <p className="text-[11px] text-slate-400 mt-1 leading-tight">{col.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-Select Primary Services */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              2. Select Primary Services <span className="text-amber-400 font-normal">(Select One or More)</span>
            </h3>
            <span className="text-[11px] text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
              {selectedServices.length} Selected
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {services.map((svc) => {
              const Icon = svc.icon;
              const isSelected = selectedServices.includes(svc.id);
              const disabled = svc.id === 'Beard' && beardUnavailable;
              return (
                <button
                  key={svc.id}
                  onClick={() => toggleService(svc.id)}
                  disabled={disabled}
                  title={disabled ? "Beard grooming is in the Men's collection" : undefined}
                  className={`p-4 rounded-2xl text-left border transition-all flex flex-col justify-between touch-target-large active:scale-95 relative disabled:opacity-40 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500 text-white ring-2 ring-amber-500/30 shadow-sm'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Icon className={`w-7 h-7 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-sm">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">{svc.title}</h4>
                    <p className="text-[11px] text-slate-400 mt-1 leading-tight">{svc.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Style Category Selection */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">3. Select Aesthetic Category</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`p-4 rounded-2xl text-left border transition-all touch-target-large active:scale-95 ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500 text-white ring-2 ring-amber-500/30 shadow-sm'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <h4 className="font-bold text-base text-amber-400">{cat.title}</h4>
                  <p className="text-xs text-slate-400 mt-1">{cat.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-4 rounded-2xl text-lg shadow-sm active:scale-[0.98] transition-all flex items-center justify-center space-x-2 touch-target-large"
        >
          <Sparkles className="w-6 h-6 text-slate-950" />
          <span>Generate My 4 Personalized Looks</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};


