import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scissors, Sparkles, User, ArrowRight, Palette, Check, Wind, AlertTriangle, RefreshCw, Ruler, Venus, Mars, VenusAndMars, Crown, Briefcase } from 'lucide-react';
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

const STEPS = ['Photos', 'Preferences', 'Your look', 'Stylist guide'];
const TRIM_SHORT: Record<string, string> = { '0cm': 'Keep length', '2cm': 'Slight trim', '5cm': 'Medium cut', custom: 'Custom' };
const TRIM_RANGE: Record<string, string> = { '0cm': '0-1 cm', '2cm': '1-2 cm', '5cm': '3-5 cm', custom: 'your amount' };
const COLLECTION_ICON: Record<string, React.ElementType> = { Women: Venus, Men: Mars, All: VenusAndMars };
const CATEGORY_ICON: Record<string, React.ElementType> = { Classic: Crown, Trendy: Sparkles, Professional: Briefcase };
const SHORT_LABEL: Record<string, string> = { Women: 'Women', Men: 'Men', All: 'All / Unisex' };

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

  const visibleServices = services.filter((svc) => !(selectedGender === 'Women' && svc.id === 'Beard'));
  const notice = (title: string, body: React.ReactNode) => (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rose-600" />
      <div className="space-y-1">
        <p className="text-sm font-bold text-rose-800">{title}</p>
        <p className="text-xs leading-relaxed text-rose-700">{body}</p>
      </div>
    </div>
  );
  const sectionTitle = (n: number, title: string, aside?: React.ReactNode) => (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2.5 text-sm font-bold text-[#1a2a20]">
        <span className="grid size-6 place-items-center rounded-full bg-[#f3d27a] text-[11px] font-bold text-[#1d3d2d]">{n}</span>
        {title}
      </h3>
      {aside}
    </div>
  );
  const categoryTitle = categories.find((c) => c.id === selectedCategory)?.title;
  const segmented = (options: { id: string; label: string; Icon?: React.ElementType }[], value: string, onPick: (id: string) => void) => (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map(({ id, label, Icon }) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(id)}
            className={`flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-4 text-[13px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2f5d46]/20 active:scale-[0.98] cursor-pointer ${
              on
                ? 'border-transparent bg-[#244a37] text-[#ffffff] shadow-md shadow-[#244a37]/20'
                : 'border-[#dfe7e1] bg-[#ffffff] text-[#33483c] hover:border-[#c3d3c9]'
            }`}
          >
            {Icon && (
              <span className={`grid size-7 shrink-0 place-items-center rounded-full ${on ? 'bg-[#ffffff]/15 text-[#f3d27a]' : 'bg-[#e4eee7] text-[#2f5d46]'}`}>
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
            )}
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="auth-rise flex-1 py-2 sm:py-4">
      <div className="w-full overflow-clip rounded-3xl border border-[#dfe7e1] bg-[#ffffff] shadow-[0_24px_60px_-30px_rgba(36,74,55,0.35)]">
        {/* Header band */}
        <div className="relative overflow-hidden bg-gradient-to-r from-[#1d3d2d] via-[#244a37] to-[#2b5740] px-5 py-5 sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-[#e9b949]/15 blur-3xl" />
          <div className="relative flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f3d27a]">Step 2 of 4</p>
              <h2 className="mt-1 text-2xl font-bold leading-tight tracking-tight text-[#ffffff]">Choose your look</h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#ffffff]/75">
                {fromLastVisit
                  ? 'Pre-selected from your last visit. Tap any option to change it.'
                  : 'Pick a collection, the services you want and a style, and we will create your previews.'}
              </p>
            </div>
            <div className="hidden shrink-0 rounded-2xl bg-[#ffffff]/10 px-4 py-2.5 text-right ring-1 ring-[#ffffff]/10 sm:block">
              <p className="text-sm font-semibold text-[#ffffff]">{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</p>
              <p className="mt-0.5 text-xs text-[#ffffff]/65">{categoryTitle} style</p>
            </div>
          </div>

          <ol aria-label="Progress, step 2 of 4" className="relative mt-4 hidden items-center gap-2 sm:flex">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <li className="flex items-center gap-2" aria-current={i === 1 ? 'step' : undefined}>
                  <span className={`grid size-6 place-items-center rounded-full text-[11px] font-bold ${
                    i === 1 ? 'bg-[#f3d27a] text-[#1d3d2d]' : i < 1 ? 'bg-[#ffffff]/90 text-[#1d3d2d]' : 'bg-[#ffffff]/10 text-[#ffffff]/60'
                  }`}>
                    {i < 1 ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
                  </span>
                  <span className={`text-xs ${i === 1 ? 'font-semibold text-[#ffffff]' : i < 1 ? 'text-[#ffffff]/85' : 'text-[#ffffff]/60'}`}>{label}</span>
                </li>
                {i < STEPS.length - 1 && <span className={`h-px min-w-3 flex-1 ${i < 1 ? 'bg-[#ffffff]/50' : 'bg-[#ffffff]/15'}`} />}
              </React.Fragment>
            ))}
          </ol>
        </div>

        {/* Body: analysis (left) + choices (right) */}
        <div className="grid items-start gap-8 p-4 sm:p-6 lg:grid-cols-[300px_1fr] lg:p-8">
          <div className="lg:sticky lg:top-24">
            <HairAnalysisCard showBeard={selectedGender !== 'Women'} onChange={() => setAnalysisVersion((v) => v + 1)} />
          </div>

          <div className="flex min-w-0 flex-col gap-8">
            {isCustomerBald && isCleanShaven && selectedGender !== 'Women' && notice(
              'Clean-shaven face and bald scalp detected',
              'Haircut, hair colouring, smoothening, and beard sculpting services are disabled because your photo analysis shows a clean-shaven bald face. Scalp care and facial spa treatments are recommended during your visit.',
            )}
            {isCustomerBald && !isCleanShaven && selectedGender !== 'Women' && notice(
              'Bald scalp detected',
              <>Haircut, hair colouring, and smoothening services are disabled because your photo analysis shows a bald scalp. <b>Beard &amp; Grooming</b> service is selected for you below.</>,
            )}
            {isCustomerBald && selectedGender === 'Women' && notice(
              'Bald scalp detected',
              'Haircut, hair colouring, and smoothening services are disabled because your photo analysis shows a bald scalp.',
            )}
            {!isCustomerBald && isCleanShaven && selectedGender !== 'Women' && notice(
              'Clean-shaven face detected',
              'Beard trimming & sculpting services are disabled because your photo analysis shows a clean-shaven face.',
            )}

            {/* 1. Collection */}
            <section>
              {sectionTitle(1, 'Style collection')}
              {segmented(
                collections.map((c) => ({ id: c.id, label: SHORT_LABEL[c.id] || c.title, Icon: COLLECTION_ICON[c.id] })),
                selectedGender,
                (id) => setSelectedGender(id as any),
              )}
              <p className="mt-2 text-xs text-[#6c7e73]">{collections.find((c) => c.id === selectedGender)?.desc}</p>
            </section>

            {/* 2. Services */}
            <section>
              {sectionTitle(2, 'Services', (
                <span className="rounded-full bg-[#fdf3d7] px-2.5 py-0.5 text-[11px] font-semibold text-[#7a5a0c]">
                  {selectedServices.length} selected · choose one or more
                </span>
              ))}
              {(() => {
                const items = visibleServices.map((svc) => {
                  const isHair = svc.id === 'Hair' || svc.id === 'Colour / Balayage' || svc.id === 'Keratin / Smoothening';
                  const isBeard = svc.id === 'Beard';
                  const disabled = (isCustomerBald && isHair) || ((isCleanShaven || beardUnavailable) && isBeard);
                  const disabledMsg = isCustomerBald && isHair
                    ? "not applicable for a bald scalp"
                    : (isCleanShaven && isBeard)
                    ? "not applicable for a clean-shaven face"
                    : (beardUnavailable && isBeard)
                    ? "beard grooming is in the Men's collection"
                    : undefined;
                  return { svc, disabled, disabledMsg };
                });
                const available = items.filter((i) => !i.disabled);
                const unavailable = items.filter((i) => i.disabled);
                const reasons = [...new Set(unavailable.map((i) => i.disabledMsg).filter(Boolean))];

                return (
                  <>
                    <div className={`grid grid-cols-1 gap-3 ${available.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                      {available.map(({ svc }) => {
                        const Icon = svc.icon;
                        const isSelected = selectedServices.includes(svc.id);
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleService(svc.id)}
                            className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2f5d46]/20 active:scale-[0.99] cursor-pointer ${
                              isSelected
                                ? 'border-transparent bg-gradient-to-br from-[#244a37] to-[#2f5d46] shadow-lg shadow-[#244a37]/25'
                                : 'border-[#dfe7e1] bg-[#ffffff] hover:border-[#c3d3c9] hover:shadow-sm'
                            }`}
                          >
                            <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${
                              isSelected ? 'bg-[#ffffff]/15 text-[#f3d27a]' : 'bg-[#e4eee7] text-[#2f5d46]'
                            }`}>
                              <Icon aria-hidden="true" className="size-6" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[15px] font-bold ${isSelected ? 'text-[#ffffff]' : 'text-[#1a2a20]'}`}>{svc.title}</span>
                              <span className={`mt-0.5 block text-xs leading-snug ${isSelected ? 'text-[#ffffff]/75' : 'text-[#6c7e73]'}`}>{svc.desc}</span>
                            </span>
                            <span className={`grid size-6 shrink-0 place-items-center rounded-full ${
                              isSelected ? 'bg-[#f3d27a] text-[#1d3d2d]' : 'border-2 border-[#c3d3c9]'
                            }`}>
                              {isSelected && <Check aria-hidden="true" className="size-3.5 stroke-[3]" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {unavailable.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#f7f8f7] px-3 py-2.5 text-[11px] text-[#7f968a]">
                        <span className="font-semibold text-[#6c7e73]">Not available:</span>
                        {unavailable.map(({ svc }) => {
                          const Icon = svc.icon;
                          return (
                            <span key={svc.id} className="inline-flex items-center gap-1.5 rounded-full bg-[#ffffff] px-2.5 py-1 font-medium text-[#8a9a92] ring-1 ring-[#ebf0ec]">
                              <Icon aria-hidden="true" className="size-3.5" />
                              {svc.title}
                            </span>
                          );
                        })}
                        {reasons.length > 0 && <span>· {reasons.join(', ')}</span>}
                      </div>
                    )}
                  </>
                );
              })()}
            </section>

            {/* 3. Category */}
            <section>
              {sectionTitle(3, 'Style category')}
              {segmented(
                categories.map((c) => ({ id: c.id, label: c.title, Icon: CATEGORY_ICON[c.id] })),
                selectedCategory,
                (id) => setSelectedCategory(id as any),
              )}
              <p className="mt-2 text-xs text-[#6c7e73]">{categories.find((c) => c.id === selectedCategory)?.desc}</p>
            </section>

            {/* 4. Trim length */}
            <section>
              {sectionTitle(4, 'Cut & trim length', (
                <span className="text-[11px] font-medium text-[#7f968a]">
                  {trimPreference ? 'Tap again to clear' : 'Optional: no choice shows any cut length'}
                </span>
              ))}
              <div className="flex flex-wrap gap-2">
                {TRIM_OPTIONS.map((option) => {
                  const isSelected = trimPreference === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setTrimPreference(isSelected ? '' : option.id)}
                      className={`flex h-10 items-center gap-2 rounded-full border pl-1.5 pr-4 text-[13px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#2f5d46]/20 active:scale-[0.98] cursor-pointer ${
                        isSelected
                          ? 'border-transparent bg-[#244a37] text-[#ffffff] shadow-md shadow-[#244a37]/20'
                          : 'border-[#dfe7e1] bg-[#ffffff] text-[#33483c] hover:border-[#c3d3c9]'
                      }`}
                    >
                      <span className={`grid size-7 shrink-0 place-items-center rounded-full ${isSelected ? 'bg-[#ffffff]/15 text-[#f3d27a]' : 'bg-[#e4eee7] text-[#2f5d46]'}`}>
                        {option.id === 'custom'
                          ? <Ruler aria-hidden="true" className="size-3.5" />
                          : <Scissors aria-hidden="true" className="size-3.5" />}
                      </span>
                      {TRIM_SHORT[option.id] || option.title}
                      <span className={`text-[11px] font-medium ${isSelected ? 'text-[#ffffff]/65' : 'text-[#8a9a92]'}`}>{TRIM_RANGE[option.id]}</span>
                    </button>
                  );
                })}
              </div>

              {trimPreference === 'custom' ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-[#fafcfa] p-3 ring-1 ring-[#dfe7e1]">
                  <label htmlFor="custom-trim-val" className="text-xs font-semibold text-[#33483c]">How much to cut?</label>
                  <input
                    id="custom-trim-val"
                    type="text"
                    value={customTrimVal}
                    onChange={(e) => setCustomTrimVal(e.target.value)}
                    placeholder="e.g. 3 cm, 15 mm, 1 inch"
                    className="h-10 w-40 rounded-full border border-[#c3d3c9] bg-[#ffffff] px-4 text-[13px] font-semibold text-[#1a2a20] placeholder-[#8b9a92] focus:border-[#2f5d46] focus:outline-none focus:ring-4 focus:ring-[#2f5d46]/12"
                  />
                  <span className="text-[11px] text-[#7f968a]">e.g. 3 cm, 15 mm, 1 inch</span>
                </div>
              ) : (
                <p className="mt-2.5 text-xs text-[#7f968a]">
                  {trimPreference
                    ? TRIM_OPTIONS.find((o) => o.id === trimPreference)?.desc
                    : 'No preference: looks of any length will be shown'}
                </p>
              )}
            </section>

            {generateError && (
              <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm font-medium text-rose-700">{generateError}</div>
            )}

            {/* Generate (sticks to the bottom on small screens) */}
            <div className="flex flex-col gap-3 border-t border-[#ebf0ec] pt-5 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-4 max-lg:-mb-4 max-lg:bg-[#ffffff]/90 max-lg:px-4 max-lg:pb-4 max-lg:backdrop-blur-md sm:max-lg:-mx-6 sm:max-lg:-mb-6 sm:max-lg:px-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[#6c7e73]">
                <span className="font-semibold text-[#1a2a20]">{collections.find((c) => c.id === selectedGender)?.title}</span>
                {' · '}{selectedServices.join(', ')}{' · '}{categoryTitle}
              </p>
              <button
                onClick={handleGenerate}
                disabled={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#244a37] to-[#2f5d46] px-7 text-sm font-semibold text-[#ffffff] shadow-lg shadow-[#244a37]/25 transition-all hover:from-[#1b392b] hover:to-[#244a37] hover:shadow-xl active:scale-[0.98] disabled:opacity-70 cursor-pointer sm:w-auto"
              >
                {loading ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" />
                    <span>Finding your looks…</span>
                  </>
                ) : (
                  <>
                    <Sparkles aria-hidden="true" className="size-4" />
                    <span>Generate my looks</span>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
