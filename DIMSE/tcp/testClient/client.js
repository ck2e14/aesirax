import { createReadStream } from "fs";
import { Socket } from "net";

// Path to the DICOM file
const filePath = "../../aesirax/data/report_structured_report_PI-Contrast.dcm";

// Create a TCP client
const client = new Socket();

// Connect to the TCP server
client.connect(8080, "127.0.0.1", () => {
   console.log("Connected to server");

   // Create a read stream for the DICOM file
   const readStream = createReadStream(filePath);

   // Pipe the read stream into the socket
   readStream.pipe(client);

   readStream.on("end", () => {
      console.log("File read complete.");
      client.end();
   });
});

// Handle data received from the server
client.on("data", data => {
   console.log("Received from server: " + data);
});

// Handle connection close
client.on("close", () => {
   console.log("Connection closed");
});

// Handle errors
client.on("error", err => {
   console.error("Connection error: " + err.message);
});
