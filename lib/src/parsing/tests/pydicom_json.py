# via claude.ai, it seems to work. for use generating comparisons on the fly 
# for diffing against aesirax's output
import pydicom
import json
import sys
from pydicom.sequence import Sequence

def convert_element(element):
    """Convert a DICOM element to a Python object for JSON serialization"""
    if isinstance(element.value, Sequence):
        return [convert_dataset(item) for item in element.value]
    elif isinstance(element.value, bytes):
        return f"[binary data: {len(element.value)} bytes]"
    elif element.tag.is_private:
        return f"[private tag: {element.tag}]"
    elif hasattr(element.value, "__iter__") and not isinstance(element.value, str):
        return list(element.value)
    else:
        return element.value if not hasattr(element.value, "original_string") else element.value.original_string

def convert_dataset(dataset):
    """Convert DICOM dataset to dictionary"""
    result = {}
    for elem in dataset:
        if elem.tag != pydicom.tag.Tag('PixelData'):  # Skip pixel data
            try:
                result[elem.name] = convert_element(elem)
            except Exception:
                result[elem.name] = str(elem.value)
    return result

def main
