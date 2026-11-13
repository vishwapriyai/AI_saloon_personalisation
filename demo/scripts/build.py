"""Assembles the demo video from record.py output: frames + marks -> narrated, captioned MP4.

usage: python build.py <recording dir> <output mp4>
"""
import asyncio, json, os, re, subprocess, sys

REC, OUT_MP4 = sys.argv[1], sys.argv[2]
WORK = os.path.join(REC, "build"); os.makedirs(WORK, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
FPS, W, H = 30, 1280, 800
VOICE, RATE = "en-IN-NeerjaNeural", "+10%"
LEAD = 0.35  # narration starts this long after its scene starts
TAIL = 0.6   # minimum silence after narration before the next scene

NARRATION = {
    "title": "This is LUXE Styling, an AI personalisation platform for salons. Let's follow one visit, from the customer, to the stylist, to the salon manager.",
    "login": "On the salon tablet, the customer logs in with a mobile number or customer ID.",
    "welcome": "Returning customers can repeat a previous look, or create a brand-new one.",
    "photos": "Next, we capture front, side and back photos, and record the customer's consent before anything is processed.",
    "analysis": "In seconds, computer vision measures face shape, hair length, texture, colour and beard. Staff can correct anything the camera misread.",
    "service": "The customer picks a collection, services and a style category, and a rule-based engine picks the best-matching looks from the catalogue.",
    "generating": "The AI then applies each look to the customer's own photo. Every result is checked automatically: same person, same face, same background.",
    "results": "Here are the recommended looks, each one on the customer's own face. The customer compares them, and confirms a favourite.",
    "instructions": "The stylist now gets a cutting guide for the chosen look,",
    "views": "with AI previews from the front, side and back, all generated from the customer's own photos.",
    "views_done": "",
    "languages": "The steps are personalised to the customer's hair, in English, Hindi and Tamil, as text and as spoken audio.",
    "approve": "Before cutting starts, the stylist signs in to approve the look. After the service, after-photos are uploaded and the visit is saved.",
    "staff_login": "Stylists have their own workstation.",
    "directory": "The customer directory shows each client's tier, visits, spend and favourite services, across every branch.",
    "client": "Each client's latest look is shown side by side: the original photo, the AI preview, and the real result after the cut.",
    "queue": "And the appointment queue lists today's customers with their chosen styles.",
    "admin_login": "Finally, the salon manager.",
    "dashboard": "The executive dashboard tracks revenue, visits, chair utilisation and active campaigns.",
    "rfm": "Customers are automatically segmented by recency, frequency and spend, and churn risk is flagged early.",
    "offers": "The offer engine then creates a personalised coupon. The discount adapts to demand and to the customer's segment, while a margin guard protects profit.",
    "end": "LUXE Styling. AI that helps customers choose with confidence, and helps salons grow.",
}
CHAPTERS = {"login": ("01", "Customer experience", "In the salon chair, on a tablet"),
            "staff_login": ("02", "Stylist workstation", "Clients, history and today's queue"),
            "admin_login": ("03", "Salon management", "Analytics, segments and smart offers")}
SPEED_BADGE = {"generating": True, "views": True}


def run(*args, **kw):
    subprocess.run(list(args), check=True, **kw)


def ffmpeg(*args):
    run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args, cwd=WORK)


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True, cwd=WORK).stdout
    return float(out.strip())


# ---------- narration ----------
TTS_PY = os.path.join(os.path.dirname(HERE), "ttsenv", "Scripts", "python.exe")


def tts(key, text):
    mp3, srt = os.path.join(WORK, f"n_{key}.mp3"), os.path.join(WORK, f"n_{key}.srt")
    src = srt + ".src"
    if os.path.exists(mp3) and os.path.exists(src) and open(src, encoding="utf-8").read() == text:
        return
    open(src, "w", encoding="utf-8").write(text)
    run(TTS_PY, os.path.join(HERE, "tts_one.py"), VOICE, RATE, src, mp3, srt)


def parse_srt(path):
    def t(s):
        h, m, rest = s.split(":"); sec, ms = rest.split(",")
        return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000
    cues = []
    for block in open(path, encoding="utf-8").read().strip().split("\n\n"):
        lines = block.strip().splitlines()
        if len(lines) >= 3:
            a, b = lines[1].split(" --> ")
            cues.append((t(a), t(b), " ".join(lines[2:])))
    return cues


# ---------- cards ----------
CARD_HTML = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
html,body{margin:0;width:1280px;height:800px;overflow:hidden}
body{background:radial-gradient(1200px 700px at 30% 20%,#2f5d4a 0%,#1f3f33 55%,#14291f 100%);color:#f6f1e7;font-family:'Nunito Sans',sans-serif;display:flex;align-items:center;justify-content:center}
.wrap{text-align:center;max-width:980px;padding:0 40px}
.logo{width:84px;height:84px;border-radius:50%;background:#f6f1e7;display:inline-flex;align-items:center;justify-content:center;margin-bottom:28px}
.kicker{letter-spacing:.28em;text-transform:uppercase;font-size:15px;font-weight:700;color:#d8b46a;margin-bottom:18px}
h1{font-family:'Fraunces',serif;font-weight:700;font-size:76px;line-height:1.05;margin:0 0 22px}
p{font-size:24px;line-height:1.5;color:#d9e4dc;margin:0}
.num{font-family:'Fraunces',serif;font-size:120px;color:rgba(216,180,106,.9);line-height:1;margin-bottom:6px}
.pills{margin-top:34px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.pill{border:1px solid rgba(246,241,231,.35);border-radius:999px;padding:9px 18px;font-size:16px;color:#f6f1e7}
</style></head><body><div class="wrap">@@BODY@@</div></body></html>"""
LEAF = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#2f5d4a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>'


async def render_cards(cards):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": W, "height": H})
        for name, body in cards.items():
            await pg.set_content(CARD_HTML.replace("@@BODY@@", body)); await pg.wait_for_load_state("networkidle")
            await pg.evaluate("document.fonts.ready")
            await pg.screenshot(path=os.path.join(WORK, f"card_{name}.png"))
        await b.close()


def card_bodies():
    cards = {
        "title": f'<div class="logo">{LEAF}</div><div class="kicker">AI Salon Personalisation</div><h1>LUXE Styling</h1>'
                 '<p>Personalised hairstyle recommendations, previewed on the customer\'s own photo.</p>'
                 '<div class="pills"><span class="pill">Face &amp; hair analysis</span><span class="pill">AI style previews</span>'
                 '<span class="pill">Stylist cutting guide</span><span class="pill">Salon analytics</span></div>',
        "end": f'<div class="logo">{LEAF}</div><h1>LUXE Styling</h1><p>Choose with confidence. Grow with insight.</p>'
               '<div class="pills"><span class="pill">React + FastAPI</span><span class="pill">MediaPipe &amp; OpenCV</span>'
               '<span class="pill">Gemini image editing</span><span class="pill">English · हिन्दी · தமிழ்</span></div>',
    }
    for key, (num, title, sub) in CHAPTERS.items():
        cards["ch_" + key] = f'<div class="num">{num}</div><h1>{title}</h1><p>{sub}</p>'
    return cards


# ---------- main ----------
def main():
    frames = json.load(open(os.path.join(REC, "frames.json")))
    marks = json.load(open(os.path.join(REC, "marks.json")))
    t0 = frames[0]["t"]

    # 1. constant-rate master video from screencast frames
    lst = os.path.join(WORK, "frames.txt")
    with open(lst, "w") as f:
        for i, fr in enumerate(frames):
            dur = (frames[i + 1]["t"] - fr["t"]) if i + 1 < len(frames) else 0.5
            f.write(f"file '{os.path.join(REC, fr['file']).replace(chr(92), '/')}'\nduration {max(dur, 0.001):.4f}\n")
        f.write(f"file '{os.path.join(REC, frames[-1]['file']).replace(chr(92), '/')}'\n")
    if not os.path.exists(os.path.join(WORK, "master.mp4")):
        ffmpeg("-f", "concat", "-safe", "0", "-i", "frames.txt", "-vf", f"fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p",
               "-c:v", "libx264", "-crf", "14", "-preset", "fast", "master.mp4")

    # 2. narration
    for k, v in NARRATION.items():
        if v:
            tts(k, v)
    asyncio.run(render_cards(card_bodies()))
    ndur = {k: probe_duration(f"n_{k}.mp3") for k, v in NARRATION.items() if v}

    # 3. timeline: list of (kind, key, args)
    timeline = [("card", "title", 0)]
    for i, m in enumerate(marks[:-1]):
        key = m["seg"]
        if key == "_cut":
            continue
        if key in CHAPTERS:
            timeline.append(("card", "ch_" + key, 2.6))
        a, b = m["t"] - t0, marks[i + 1]["t"] - t0
        timeline.append(("clip", key, (a, b, m["speed"])))
    timeline.append(("card", "end", 0))

    clips, captions, offset = [], [], 0.0
    for n, (kind, key, arg) in enumerate(timeline):
        out = f"seg_{n:02d}.mp4"
        narr = ndur.get(key, 0.0)
        need = (LEAD + narr + TAIL) if narr else 0.0
        if kind == "card":
            dur = max(arg, need, 3.0)
            fade = f"fade=in:st=0:d=0.5,fade=out:st={dur - 0.5:.2f}:d=0.5"
            ffmpeg("-loop", "1", "-t", f"{dur:.3f}", "-i", f"card_{key}.png", "-vf", f"fps={FPS},format=yuv420p,{fade}",
                   "-c:v", "libx264", "-crf", "16", "-preset", "fast", out)
        else:
            a, b, speed = arg
            src = b - a
            if speed == 0:  # auto: compress waiting time to fit the narration
                speed = max(1.0, src / max(need, 5.0))
            elif need and src > need + 2.5:  # trim idle UI time after the narration (at most 2x)
                speed = min(2.0, src / (need + 1.2))
            dur_fast = src / speed
            pad = max(0.0, need - dur_fast)
            vf = [f"setpts=(PTS-STARTPTS)/{speed:.4f}", f"fps={FPS}"]
            if pad > 0.01:
                vf.append(f"tpad=stop_mode=clone:stop_duration={pad:.3f}")
            if SPEED_BADGE.get(key) and speed > 1.5:
                vf.append("drawtext=fontfile='C\\:/Windows/Fonts/segoeuib.ttf':text='%d× speed':x=w-tw-28:y=96:fontsize=20:"
                          "fontcolor=white:box=1:boxcolor=0x1f3f33@0.85:boxborderw=12" % round(speed))
            ffmpeg("-ss", f"{a:.3f}", "-t", f"{src:.3f}", "-i", "master.mp4", "-vf", ",".join(vf), "-an",
                   "-c:v", "libx264", "-crf", "16", "-preset", "fast", out)
            dur = dur_fast + pad
        dur = probe_duration(out)
        # audio for this segment
        aout = f"a_{n:02d}.wav"
        if narr:
            ms = int(LEAD * 1000)
            ffmpeg("-i", f"n_{key}.mp3", "-af", f"adelay={ms}|{ms},apad", "-t", f"{dur:.3f}", "-ar", "48000", "-ac", "2", aout)
            for s, e, text in parse_srt(os.path.join(WORK, f"n_{key}.srt")):
                captions.append((offset + LEAD + s, offset + LEAD + e, text))
        else:
            ffmpeg("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", f"{dur:.3f}", aout)
        clips.append((out, aout)); offset += dur
        print(f"{n:02d} {kind:4s} {key:13s} {dur:6.2f}s  narration {narr:5.2f}s", flush=True)

    # 4. concat video + audio
    with open(os.path.join(WORK, "v.txt"), "w") as f:
        f.writelines(f"file '{c}'\n" for c, _ in clips)
    with open(os.path.join(WORK, "a.txt"), "w") as f:
        f.writelines(f"file '{a}'\n" for _, a in clips)
    ffmpeg("-f", "concat", "-safe", "0", "-i", "v.txt", "-c", "copy", "video.mp4")
    ffmpeg("-f", "concat", "-safe", "0", "-i", "a.txt", "-c:a", "pcm_s16le", "audio.wav")

    # 5. captions (ASS, bottom band) + final mux
    def ts(x):
        h, r = divmod(x, 3600); m, s = divmod(r, 60)
        return f"{int(h)}:{int(m):02d}:{s:05.2f}"
    ass = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
           "[V4+ Styles]",
           "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
           "Style: Cap,Segoe UI Semibold,25,&H00FFFFFF,&H00FFFFFF,&H18333F1F,&H18333F1F,0,0,0,0,100,100,0,0,3,11,0,2,140,140,30,1",
           "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for s, e, text in captions:
        ass.append(f"Dialogue: 0,{ts(s)},{ts(e)},Cap,,0,0,0,,{text}")
    open(os.path.join(WORK, "captions.ass"), "w", encoding="utf-8").write("\n".join(ass) + "\n")
    ffmpeg("-i", "video.mp4", "-i", "audio.wav", "-vf", "ass=captions.ass", "-c:v", "libx264", "-crf", "19", "-preset", "slow",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", os.path.abspath(OUT_MP4))
    print(f"total {offset:.1f}s -> {OUT_MP4}")


main()
