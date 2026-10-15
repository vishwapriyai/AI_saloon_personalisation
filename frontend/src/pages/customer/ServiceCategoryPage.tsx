import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Sparkles, User, ArrowRight, Palette, Check, Wind, AlertTriangle } from 'lucide-react';
import { getRecommendations, getLastPreferences } from '../../api/client';
import { currentCustomerId } from '../../auth/session';
import { HairAnalysisCard } from '../../components/HairAnalysisCard';

/** "Hair Cut & Trim Length Preference" buttons; `value` is what the server reads (see parse_trim_cm). */
const TRIM_OPTIONS = [
  { id: '0cm', title: 'Keep Original Length', desc: '0 - 1 cm micro-trim', value: '0 - 1 cm micro-trim' },
  { id: '2cm', title: 'Slight Trim', desc: '1 - 2 cm short', value: '2cm' },
  { id: '5cm', title: 'Medium Cut', desc: '3 - 5 cm short', value: '5cm' },
  { id: 'custom', title: 'Custom Cut', desc: 'Specify cm / mm short', value: '' },
];

export const ServiceCategoryPage: React.FC = () => {
  const navigate = useNavigate();
  // Check if customer photo analysis indicates a bald or clean shaved scalp or gender
  const photoAnalysis = (() => {
    try {
      return JSON.parse(localStorage.getItem('salon_photo_analysis') || 'null');
    } catch {
      return null;
    }
  })();
  const detectedGender = photoAnalysis?.gender === 'Men' || photoAnalysis?.gender === 'Male' ? 'Men' : 'Women';
  const [selectedGender, setSelectedGender] = useState<'Women' | 'Men' | 'All'>(() => {
    const saved = localStorage.getItem('salon_customer_gender');
    if (saved === 'Men' || saved === 'Male') return 'Men';
    if (saved === 'Women' || saved === 'Female') return 'Women';
    return detectedGender;
  });
  const [selectedServices, setSelectedServices] = useState<string[]>(['Hair']);
  const [selectedCategory, setSelectedCategory] = useState<'Classic' | 'Trendy' | 'Professional'>('Trendy');
  // Which trim button is chosen ('' = no preference: any cut). The value sent to the server is derived from it.
  const [trimPreference, setTrimPreference] = useState<string>(() => {
    const saved = localStorage.getItem('salon_trim_choice') || '';
    return TRIM_OPTIONS.some((o) => o.id === saved) ? saved : '';
  });
  const [customTrimVal, setCustomTrimVal] = useState<string>(() => localStorage.getItem('salon_trim_custom') || '2 cm');
  const [loading, setLoading] = useState(false);
  const [fromLastVisit, setFromLastVisit] = useState(false);
  // Bumped when the stylist corrects the analysis (e.g. beard or baldness misread) so the service rules re-run
  const [, setAnalysisVersion] = useState(0);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const hairLen = String(photoAnalysis?.hair_length || '').toLowerCase();
  const hairDen = String(photoAnalysis?.hair_density || '').toLowerCase();
  const beardStyle = String(photoAnalysis?.beard_style_current || photoAnalysis?.beard_style || '').toLowerCase();
  const isCustomerBald = hairLen === 'bald' || hairDen.includes('bald') || hairDen.includes('sparse');
  const isCleanShaven = !beardStyle || beardStyle === 'clean shaven' || beardStyle === 'none' || beardStyle === 'unknown';

  useEffect(() => {
    localStorage.setItem('salon_customer_gender', selectedGender);
  }, [selectedGender]);

  useEffect(() => {
    localStorage.setItem('salon_trim_choice', trimPreference);
    localStorage.setItem('salon_trim_custom', customTrimVal);
  }, [trimPreference, customTrimVal]);

  // Returning customers: pre-select what they chose last time (they can still change it)
  useEffect(() => {
    const customerId = Number(localStorage.getItem('salon_customer_id') || 0);
    localStorage.removeItem('salon_last_hairstyle_id');
    if (!customerId) return;
    let active = true;
    getLastPreferences(customerId)
      .then((prefs) => {
        if (!active || !prefs) return;
        if (prefs.gender) {
          const gStr = String(prefs.gender);
          const g = (gStr === 'Men' || gStr === 'Male') ? 'Men' : 'Women';
          setSelectedGender(g);
        }
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

  const beardUnavailable = selectedGender === 'Women';

  // Enforce service availability based on photo analysis:
  // - Bald head -> disable Haircut, Hair Colour, Smoothening
  // - Clean-shaven face -> disable Beard & Grooming
  useEffect(() => {
    let updated = [...selectedServices];

    if (isCustomerBald) {
      updated = updated.filter((s) => s === 'Beard');
    }
    if (isCleanShaven) {
      updated = updated.filter((s) => s !== 'Beard');
    }

    if (updated.length === 0) {
      if (!isCustomerBald) updated = ['Hair'];
      else if (!isCleanShaven && selectedGender !== 'Women') updated = ['Beard'];
    }

    if (JSON.stringify(updated) !== JSON.stringify(selectedServices)) {
      setSelectedServices(updated);
    }
  }, [isCustomerBald, isCleanShaven, selectedGender, selectedServices]);

  const toggleService = (serviceId: string) => {
    const isHair = serviceId === 'Hair' || serviceId === 'Colour / Balayage' || serviceId === 'Keratin / Smoothening';
    const isBeard = serviceId === 'Beard';

    if (isCustomerBald && isHair) return;
    if ((isCleanShaven || beardUnavailable) && isBeard) return;

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
    setGenerateError(null);
    const customerId = currentCustomerId();
    const photoId = Number(localStorage.getItem('salon_photo_id') || 0);

    try {
      // No trim choice = any cut: nothing is sent, and the previews are not limited in length
      const activeTrim = trimPreference === 'custom'
        ? (customTrimVal.trim() || undefined)
        : TRIM_OPTIONS.find((o) => o.id === trimPreference)?.value;
      if (activeTrim) localStorage.setItem('salon_trim_preference', activeTrim);
      else localStorage.removeItem('salon_trim_preference');

      const rec = await getRecommendations({
        customer_id: customerId,
        photo_id: photoId,
        target_service_type: selectedServices.join(', '),
        style_category: selectedCategory,
        gender: selectedGender,
        trim_preference: activeTrim,
      });

      localStorage.setItem('salon_recommendation_id', String(rec.recommendation_id));
      localStorage.setItem('salon_recommended_styles', JSON.stringify(rec.recommended_styles));
      navigate('/customer/generate');
    } catch (err) {
      // e.g. no hair services for a bald scalp: show the reason instead of continuing with stale looks
      setGenerateError(err instanceof Error ? err.message : 'Could not find looks. Please try again.');
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

        <HairAnalysisCard showBeard={selectedGender !== 'Women'} onChange={() => setAnalysisVersion((v) => v + 1)} />

        {isCustomerBald && isCleanShaven && selectedGender !== 'Women' && (
          <div className="bg-red-500/10 border-2 border-red-500/80 p-4 rounded-2xl flex items-start space-x-3 text-red-200 text-xs sm:text-sm shadow-md ring-1 ring-red-500/30">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-red-300 block text-sm">Notice: Clean-Shaved & Bald Scalp Detected</span>
              <p className="text-slate-200 leading-relaxed">
                Haircut, hair colouring, smoothening, and beard sculpting services are disabled because your photo analysis shows a clean-shaven bald face. Scalp care and facial spa treatments are recommended during your visit.
              </p>
            </div>
          </div>
        )}

        {isCustomerBald && !isCleanShaven && selectedGender !== 'Women' && (
          <div className="bg-red-500/10 border-2 border-red-500/80 p-4 rounded-2xl flex items-start space-x-3 text-red-200 text-xs sm:text-sm shadow-md ring-1 ring-red-500/30">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-red-300 block text-sm">Notice: Bald Scalp Detected</span>
              <p className="text-slate-200 leading-relaxed">
                Haircut, hair colouring, and smoothening services are disabled because your photo analysis shows a bald scalp. <b>Beard & Grooming</b> service is selected for you below.
              </p>
            </div>
          </div>
        )}

        {isCustomerBald && selectedGender === 'Women' && (
          <div className="bg-red-500/10 border-2 border-red-500/80 p-4 rounded-2xl flex items-start space-x-3 text-red-200 text-xs sm:text-sm shadow-md ring-1 ring-red-500/30">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-red-300 block text-sm">Notice: Bald Scalp Detected</span>
              <p className="text-slate-200 leading-relaxed">
                Haircut, hair colouring, and smoothening services are disabled because your photo analysis shows a bald scalp.
              </p>
            </div>
          </div>
        )}

        {!isCustomerBald && isCleanShaven && selectedGender !== 'Women' && (
          <div className="bg-red-500/10 border-2 border-red-500/80 p-4 rounded-2xl flex items-start space-x-3 text-red-200 text-xs sm:text-sm shadow-md ring-1 ring-red-500/30">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-red-300 block text-sm">Notice: Clean-Shaven Face Detected</span>
              <p className="text-slate-200 leading-relaxed">
                Beard trimming & sculpting services are disabled because your photo analysis shows a clean-shaven face.
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
            {services.filter((svc) => !(selectedGender === 'Women' && svc.id === 'Beard')).map((svc) => {
              const Icon = svc.icon;
              const isSelected = selectedServices.includes(svc.id);
              const isHair = svc.id === 'Hair' || svc.id === 'Colour / Balayage' || svc.id === 'Keratin / Smoothening';
              const isBeard = svc.id === 'Beard';
              const disabled = (isCustomerBald && isHair) || ((isCleanShaven || beardUnavailable) && isBeard);
              const disabledMsg = isCustomerBald && isHair
                ? "Not applicable for bald scalp"
                : (isCleanShaven && isBeard)
                ? "Not applicable for clean-shaven face"
                : (beardUnavailable && isBeard)
                ? "Beard grooming is in Men's collection"
                : undefined;

              return (
                <button
                  key={svc.id}
                  onClick={() => toggleService(svc.id)}
                  disabled={disabled}
                  title={disabledMsg}
                  className={`p-4 rounded-2xl text-left border transition-all flex flex-col justify-between touch-target-large active:scale-95 relative disabled:opacity-30 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500 text-white ring-2 ring-amber-500/30 shadow-sm'
                      : disabled
                      ? 'bg-slate-900/40 border-slate-800 text-slate-600'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <Icon className={`w-7 h-7 ${isSelected ? 'text-amber-400' : disabled ? 'text-slate-600' : 'text-slate-400'}`} />
                    {isSelected ? (
                      <div className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 flex items-center justify-center shadow-sm">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    ) : disabled ? (
                      <span className="text-[9px] uppercase font-bold text-red-400/90 bg-red-500/10 px-1.5 py-0.5 rounded border border-red-500/20">
                        Disabled
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <h4 className={`font-bold text-sm ${disabled ? 'text-slate-500 line-through' : 'text-white'}`}>{svc.title}</h4>
                    <p className="text-[11px] text-slate-400 mt-1 leading-tight">{disabledMsg || svc.desc}</p>
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

        {/* Trim / Cut Length Preference Selector */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
            <span>4. Hair Cut & Trim Length Preference</span>
            <span className="text-amber-400 font-normal text-[11px]">
              {trimPreference ? 'Tap again to clear' : 'Optional: no choice shows any cut length'}
            </span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {TRIM_OPTIONS.map((option) => {
              const isSelected = trimPreference === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setTrimPreference(isSelected ? '' : option.id)}
                  className={`p-3.5 rounded-2xl text-left border transition-all touch-target-large active:scale-95 ${
                    isSelected
                      ? 'bg-amber-500/10 border-amber-500 text-white ring-2 ring-amber-500/30 shadow-sm'
                      : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs text-amber-400">{option.title}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 stroke-[3]" />}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-tight">{option.desc}</p>
                </button>
              );
            })}
          </div>
          {trimPreference === 'custom' && (
            <div className="mt-3 flex items-center gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-700">
              <label htmlFor="custom-trim-val" className="text-xs text-slate-300 font-semibold whitespace-nowrap">Custom Trim Amount:</label>
              <input
                id="custom-trim-val"
                type="text"
                value={customTrimVal}
                onChange={(e) => setCustomTrimVal(e.target.value)}
                placeholder="e.g. 3 cm, 15 mm, 1 inch"
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500 flex-1"
              />
            </div>
          )}
        </div>

        {generateError && (
          <div role="alert" className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300 text-center">{generateError}</div>
        )}
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-4 rounded-2xl text-lg shadow-sm active:scale-[0.98] transition-all flex items-center justify-center space-x-2 touch-target-large"
        >
          <Sparkles className="w-6 h-6 text-slate-950" />
          <span>Generate My Personalized Looks</span>
          <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};


