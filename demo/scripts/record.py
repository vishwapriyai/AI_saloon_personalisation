"""Drives the salon app through the demo storyboard and records it via CDP screencast.

Output (in OUT dir): frames/*.jpg, frames.json [{file, t}], marks.json [{seg, t, speed}]
"""
import asyncio, base64, json, os, sys, time
from playwright.async_api import async_playwright

OUT = sys.argv[1]
U = "http://localhost:5173"
ORIG = "D:/AI_based_saloon_personalition/backend/media_storage/original/"
PHOTOS = [ORIG + "cust_4_front_4695fb85d5.jpg", ORIG + "cust_4_side_5e45252172.jpg", ORIG + "cust_4_back_0dc5622225.jpg"]
W, H = 1280, 800

CURSOR_JS = r"""
(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .08s';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 10-7 1.5L8.5 21z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const pos = JSON.parse(sessionStorage.getItem('__cur') || '[640,400]');
    c.style.left = pos[0] + 'px'; c.style.top = pos[1] + 'px';
    document.addEventListener('mousemove', e => {
      c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px';
      sessionStorage.setItem('__cur', JSON.stringify([e.clientX, e.clientY]));
    }, true);
    document.addEventListener('mousedown', e => {
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${e.clientX-18}px;top:${e.clientY-18}px;width:36px;height:36px;border-radius:50%;background:rgba(245,158,11,.45);z-index:2147483646;pointer-events:none;transition:all .45s ease-out`;
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
"""


def nav(page, label):
    return page.get_by_role("link", name=label, exact=True).or_(page.get_by_role("button", name=label, exact=True)).locator("visible=true").first


class Recorder:
    def __init__(self, out):
        self.out = out; self.frames = []; self.marks = []
        os.makedirs(os.path.join(out, "frames"), exist_ok=True)

    async def start(self, page):
        self.page = page
        self.cdp = await page.context.new_cdp_session(page)
        self.cdp.on("Page.screencastFrame", self._on_frame)
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})

    def _on_frame(self, ev):
        n = len(self.frames)
        name = f"frames/{n:06d}.jpg"
        with open(os.path.join(self.out, name), "wb") as f:
            f.write(base64.b64decode(ev["data"]))
        self.frames.append({"file": name, "t": ev["metadata"]["timestamp"]})
        asyncio.ensure_future(self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]}))

    def mark(self, seg, speed=1.0):
        print(f"[{time.strftime('%H:%M:%S')}] mark {seg}", flush=True)
        self.marks.append({"seg": seg, "t": time.time(), "speed": speed})

    async def keepalive(self, seconds):
        """Hold on the current view; nudges a repaint so the screencast keeps emitting frames."""
        end = time.time() + seconds
        while time.time() < end:
            await self.page.evaluate("document.getElementById('__cursor') && (document.getElementById('__cursor').style.opacity = (Math.random()*0.002+0.998).toString())")
            await asyncio.sleep(0.2)

    async def stop(self):
        self.mark("END")
        await self.cdp.send("Page.stopScreencast")
        await asyncio.sleep(0.5)
        json.dump(self.frames, open(os.path.join(self.out, "frames.json"), "w"))
        json.dump(self.marks, open(os.path.join(self.out, "marks.json"), "w"))


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=1)
        await ctx.add_init_script(CURSOR_JS)
        page = await ctx.new_page()
        rec = Recorder(OUT)
        hold = rec.keepalive

        async def move_to(loc, click=True):
            await loc.scroll_into_view_if_needed()
            box = await loc.bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            await page.mouse.move(x, y, steps=22)
            await asyncio.sleep(0.25)
            if click:
                await page.mouse.down(); await asyncio.sleep(0.06); await page.mouse.up()

        async def type_into(loc, text):
            await move_to(loc)
            await page.keyboard.type(text, delay=70)

        async def scroll(dy, steps=24):
            for _ in range(steps):
                await page.mouse.wheel(0, dy / steps); await asyncio.sleep(0.03)

        # Blank start page so the first frames aren't empty
        await page.goto(U + "/customer/login"); await page.wait_for_load_state("networkidle")
        await rec.start(page)
        await hold(0.5)

        if os.environ.get('SKIP_CUSTOMER'):
            await stylist_admin(page, rec, hold, move_to, type_into, scroll); return
        # --- Customer login
        rec.mark("login")
        await type_into(page.locator("input[placeholder^='e.g.']"), "CUST-1004")
        await type_into(page.locator("input[placeholder='••••••••']"), "Customer@123")
        await move_to(page.locator("button[type=submit]"))
        await page.get_by_text("Generate New Style").first.wait_for()
        rec.mark("welcome"); await hold(1.2)
        await scroll(250); await hold(0.8)
        await move_to(page.get_by_text("Generate New Style").first)
        await page.wait_for_url("**/customer/photo")

        # --- Photos
        rec.mark("photos"); await hold(0.8)
        inputs = page.locator("input[type=file]")
        for i, f in enumerate(PHOTOS):
            await move_to(page.get_by_role("button", name="Take / Upload").nth(i), click=False)
            await inputs.nth(i).set_input_files(f); await hold(0.7)
        await scroll(420); await hold(1.5)
        await move_to(page.get_by_role("button", name="Continue"))
        await page.wait_for_url("**/customer/service", timeout=120000)

        # --- Analysis + service choice
        rec.mark("analysis"); await hold(1.5)
        await scroll(330); await hold(3.0)
        rec.mark("service")
        await scroll(520); await hold(0.6)
        await move_to(page.locator("button", has=page.locator("h4", has_text="Men's Collection")).filter(has_not_text="Women"))
        await hold(0.4)
        # The page pre-selects last visit's services: leave exactly "Haircut & Hairstyle" selected
        for title in ["Haircut & Hairstyle", "Hair Colour", "Smoothening & Perms", "Beard & Grooming"]:
            btn = page.locator("button", has=page.locator("h4", has_text=title))
            if not await btn.count() or await btn.is_disabled():
                continue
            selected = "amber-500/10" in (await btn.get_attribute("class") or "")
            if selected != (title == "Haircut & Hairstyle"):
                await move_to(btn); await hold(0.4)
        await hold(0.4)
        await move_to(page.locator("button", has=page.locator("h4", has_text="Trendy")))
        await hold(0.8)
        await move_to(page.get_by_role("button", name="Generate My Personalized Looks"))

        # --- Generation (sped up later)
        rec.mark("generating", speed=0)  # 0 = auto-fit to narration
        await page.wait_for_url("**/customer/recommendations", timeout=600000)
        try:
            await page.get_by_text("Creating your look").first.wait_for(timeout=30000)
        except Exception:
            print("WARN: never saw 'Creating your look'", flush=True)
        for _ in range(300):
            if await page.get_by_text("Creating your look").count() == 0:
                break
            await hold(1)
        rec.mark("results"); await hold(2.0)
        cards = page.locator("img[loading=lazy]")
        n = await cards.count()
        print("generated previews:", n, flush=True)
        for i in range(min(n, 4)):
            await move_to(cards.nth(i), click=False); await hold(0.9)
        pick = cards.nth(1 if n > 1 else 0)
        await move_to(pick); await hold(1.2)
        await move_to(page.get_by_role("button", name="Confirm Selection"))
        await page.wait_for_url("**/customer/instructions", timeout=60000)

        # --- Instructions (side/back previews generate here)
        rec.mark("instructions"); await hold(2.0)
        rec.mark("views", speed=0)
        for _ in range(240):
            if await page.get_by_text("Generating...").count() == 0 and await page.get_by_text("Generating…").count() == 0:
                break
            await hold(1)
        rec.mark("views_done"); await hold(2.0)
        async def tail():
            rec.mark("languages")
            await move_to(page.get_by_role("radio", name="हिन्दी")); await hold(2.5)
            await move_to(page.get_by_role("radio", name="தமிழ்")); await hold(2.5)
            await move_to(page.get_by_role("radio", name="English")); await hold(1.0)
            await scroll(620); await hold(1.5)
            await scroll(420); await hold(1.0)
            rec.mark("approve")
            await type_into(page.get_by_placeholder("Stylist username"), "stylist")
            await type_into(page.get_by_placeholder("Password"), "Stylist@123")
            await move_to(page.get_by_role("button", name="Approve"))
            await hold(3.0)
            try:
                await page.wait_for_url("**/confirmation", timeout=8000)
            except Exception:
                pass
            await hold(2.5)
            await scroll(300); await hold(2.0)
        try:
            await tail()
        except Exception as e:
            print("WARN customer tail failed:", repr(e)[:300], flush=True)

        await stylist_admin(page, rec, hold, move_to, type_into, scroll)
        await browser.close()


async def stylist_admin(page, rec, hold, move_to, type_into, scroll):
    U_ = U
    if True:
        # --- Stylist workstation
        rec.mark("_cut")
        await page.evaluate("localStorage.clear(); sessionStorage.removeItem('__cur')")
        await page.goto(U + "/staff/login"); await page.wait_for_load_state("networkidle")
        await hold(0.3)
        rec.mark("staff_login")
        await type_into(page.locator("input").nth(0), "stylist")
        await type_into(page.locator("input[type=password]"), "Stylist@123")
        await move_to(page.locator("button[type=submit]"))
        await page.wait_for_url("**/stylist/customers")
        # The default branch grid shows real customers' photos: cut it, show only the sample customers
        rec.mark("_cut")
        await page.get_by_role("tab", name="All branches").click()
        await page.get_by_placeholder("Mobile number or customer ID", exact=False).fill("CUST-100")
        await page.get_by_text("David Miller").first.wait_for(); await hold(1.0)
        rec.mark("directory"); await hold(1.2)
        await scroll(450); await hold(1.5); await scroll(-450); await hold(0.6)
        rec.mark("client")
        await move_to(page.get_by_text("David Miller").first); await hold(2.0)
        await scroll(420); await hold(2.5)
        for tab in ["Side", "Back", "Front"]:
            btn = page.get_by_role("button", name=tab, exact=True)
            if await btn.count():
                await move_to(btn.first); await hold(1.3)
        await scroll(520); await hold(2.0)
        rec.mark("queue")
        await move_to(nav(page, "Appointments"))
        await hold(3.5)

        # --- Admin
        rec.mark("_cut")
        await page.evaluate("localStorage.clear()")
        await page.goto(U + "/staff/login"); await page.wait_for_load_state("networkidle")
        await hold(0.3)
        rec.mark("admin_login")
        await type_into(page.locator("input").nth(0), "admin")
        await type_into(page.locator("input[type=password]"), "Admin@123")
        await move_to(page.locator("button[type=submit]"))
        await page.wait_for_url("**/admin/**")
        rec.mark("dashboard"); await hold(1.0)
        for card in ["Total Revenue", "Total Visits", "Capacity Utilization", "Active Campaigns"]:
            loc = page.get_by_text(card, exact=False).first
            if await loc.count():
                await move_to(loc, click=False); await hold(0.8)
        rec.mark("rfm")
        await move_to(nav(page, "Customers")); await hold(1.5)
        await scroll(450); await hold(1.0)
        await move_to(page.get_by_text("High Risk").first, click=False); await hold(2.5)
        rec.mark("offers")
        await move_to(nav(page, "Offers & Coupons")); await hold(1.2)
        # Karan already got a coupon during test runs (30-day cooldown -> 0%); use a customer without one
        sel = page.locator("select").first
        await move_to(sel, click=False); await sel.select_option("3"); await hold(1.0)
        await move_to(page.get_by_role("button", name="Calculate Automated Discount", exact=False)); await hold(4.0)
        await scroll(300); await hold(3.0)

        await rec.stop()


asyncio.run(main())
