import io
import os
from google import genai
from google.genai import types
from PIL import Image

# Initialize the Vertex AI Client using your Google Cloud Project with active credits
client = genai.Client(
    vertexai=True,
    project="project-5b95fd61-d6de-4a78-913",
    location="us-central1"
)

# In Vertex AI with the Google GenAI SDK, image generation is performed using the multimodal image models
# such as 'gemini-2.5-flash-image' or 'gemini-3-pro-image' with response_modalities=["TEXT", "IMAGE"]
MODEL_ID = "gemini-2.5-flash-image"
PROMPT = "A beautiful sunset over a cyber-punk city skyline, photorealistic, 4k resolution"
OUTPUT_FILENAME = "sunset_cit.jpg"

print(f"Connecting to Vertex AI ({client.vertexai}) in project 'project-5b95fd61-d6de-4a78-913'...")
print(f"Generating image with model '{MODEL_ID}'...")

try:
    response = client.models.generate_content(
        model=MODEL_ID,
        contents=PROMPT,
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"]
        )
    )

    image_saved = False
    for candidate in response.candidates or []:
        for part in (candidate.content.parts if candidate.content else []) or []:
            if part.inline_data and part.inline_data.data:
                # part.inline_data.data contains the raw image bytes
                img_bytes = part.inline_data.data
                image = Image.open(io.BytesIO(img_bytes))
                image.save(OUTPUT_FILENAME)
                print(f"\n[SUCCESS] Image successfully generated and saved locally as '{OUTPUT_FILENAME}'!")
                print(f"Image format: {image.format}, Size: {image.size}, Bytes: {len(img_bytes)}")
                image_saved = True
                break

    if not image_saved:
        print("\n[WARNING] No image bytes returned in the model response.")
        if response.text:
            print("Model text output:", response.text)

except Exception as e:
    print(f"\n[ERROR] An error occurred: {e}")
