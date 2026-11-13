"""usage: tts_one.py <voice> <rate> <text file> <out mp3> <out srt>  (run with the edge-tts 7.3.1 venv)"""
import asyncio, sys
import edge_tts
voice, rate, txt, mp3, srt = sys.argv[1:]
async def main():
    com = edge_tts.Communicate(open(txt, encoding="utf-8").read(), voice, rate=rate)
    sub = edge_tts.SubMaker()
    with open(mp3, "wb") as f:
        async for chunk in com.stream():
            if chunk["type"] == "audio": f.write(chunk["data"])
            elif chunk["type"] in ("WordBoundary", "SentenceBoundary"): sub.feed(chunk)
    open(srt, "w", encoding="utf-8").write(sub.get_srt())
asyncio.run(main())
