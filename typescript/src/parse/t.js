const dicomField = Buffer.from("SMITH\0\0\0\0\0");

// If we just convert to a string, we get null bytes included
console.log(dicomField.toString()); // Outputs: "SMITH�����" (� represents null bytes)

// If we trim null bytes:
console.log(dicomField.toString().replace(/\0+$/, ""));
