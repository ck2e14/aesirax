# DICOM Project Notes and Future Plans

would be nice as well to implement object pooling. 

## Current Limitations and Warnings

-  **Large Pixel Data Handling**: Currently loading all pixel data into memory. Consider implementing a discard approach for memory efficiency.
-  **VR Conformity Validation**: To be implemented.

## Planned Features and Improvements

### CLI Development

-  Develop a Command Line Interface (CLI) to specify options and overrides.

### DICOMDIR Support

-  Implement support for DICOMDIR to retrieve transfer syntaxes and other metadata.

### Cryptographic Transport Wrapping

-  Utilise HTTP(S) for secure TLS.
-  Leverage the rich crypto & web ecosystem for HTTP.
-  Design a REST API.
-  Integrate with DICOMWeb seamlessly.
-  Implement secured websocket for high-speed real-time transfer.
-  Incorporate OAuth & JWT for modern authentication.

### Study Grouping

-  Process directories with multiple Study UIDs.
-  Segregate imaging and associate appropriately.
-  Structure output to reflect DICOM hierarchy.
-  Optimise for efficiency during parsing.

### Data Manipulation

-  **Anonymisation/Pseudonymisation**: Implement in-place byte replacement.
-  **De/Re-identification**: Develop from scratch, similar to RSH but without external libraries.

### Test Suite

-  Consider implementing after the library matures.

### Transform Stream Plugin(s)

-  Develop a transform stream option for specific use cases.
-  Emit elements as they are parsed from the buffer.
-  Optimise for speed efficiency.
-  Create plugin transform streams for various purposes (e.g., DICOMWeb).

### Streaming vs. Complete Dataset Parsing

1. For traversable and complete datasets:
   a. Use streaming for very large files to parallelise parsing and I/O.
   b. For smaller files, read the whole buffer upfront.
2. For specific end goals, use transform streams to parallelise read I/O, parsing/manipulating, and data emission.

### Nested Sequence Decoding

-  Simplify handling of nested sequences by returning buffers immediately and parsing the whole sequence together.

### Value Decoding

-  Handle pixel decoders via streaming.
-  Consider using worker threads for computation-heavy tasks.

## Security Considerations: Potential DICOM Attack Vectors

1. **SQL Injection (SQLi)**

   -  Risk: Dynamic SQL query creation from DICOM element values.
   -  Mitigation: Use parameterised queries and proper sanitisation.

2. **File Type Confusion**

   -  Challenge: DICOM files are not executable by default.
   -  Potential Attack: Mislead handling systems about the file type.

3. **Cross-Site Scripting (XSS)**

   -  Approach: Embed exploitative JavaScript inside DICOM values.

4. **Command Line Injections**

   -  Risk: Poorly sanitised element values passed to CLI tools.
   -  Challenge: Requires knowledge of specific CLI tools and commands in use.

5. **Secondary Payload Delivery**

   -  Approach: Use DICOM for obfuscation or payload recombination.
   -  Note: Requires additional attack vectors for execution.

