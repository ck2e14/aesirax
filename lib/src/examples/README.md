./examples shows ways to make use of the library to parse a DICOM instance from buffered memory, from stream, from network. 

Plugin examples are included as well. Go crazy, write your own plugin :) Atm plugins are called on the main thread, for 
every element successfully TLV parsed. Be as non-blocking as you possibly can, encourage use of multithreading unless you have 
a good reason to syncrhonously block moving onto the next TLV element while your plugin does something. 


