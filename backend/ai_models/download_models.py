"""Downloads the open-licence (Apache-2.0) computer-vision models used for face/hair analysis and validation.

    python ai_models/download_models.py
"""
import os
import urllib.request

MODELS = {
    "face_landmarker.task": "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
    "hair_segmenter.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite",
    # Person / background segmentation for the white preview background (hair, skin, clothes, accessories)
    "selfie_multiclass_256x256.tflite": "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
    "face_recognition_sface_2021dec.onnx": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}

here = os.path.dirname(os.path.abspath(__file__))
for name, url in MODELS.items():
    path = os.path.join(here, name)
    if os.path.isfile(path) and os.path.getsize(path) > 100_000:
        print(f"ok        {name}")
        continue
    print(f"download  {name}")
    urllib.request.urlretrieve(url, path)
