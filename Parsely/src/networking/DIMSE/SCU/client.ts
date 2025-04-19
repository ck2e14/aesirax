import net from "net";

// Writing an A-ASSOCIATE-RQ from scratch
// dicom.nema.org/medical/dicom/current/output/chtml/part08/sect_9.3.2.html

const MAX_AET_LEN = 16;

/**
 * Main function to run the playground client.
 */
main();
function main() {
   // TODO - make the 'variable items' property, which needs:
   // - 1 Application Context DONE
   // - 1-n Presentation Context Items:
   // - 1 Uesr Information Item:
   const A_ASSOCIATE_RQ = _A_ASSOCIATE_RQ();

   sendTcpRequest("127.0.0.1", 8888, A_ASSOCIATE_RQ, (response: any, error: any) => {
      if (error) {
         console.error("Error during communication:", error);
      } else {
         console.log("Server responded:", response);
      }
   });
}

/**
 * Creates a buffer representing an  A-ASSOCIATE-RQ message.
 * @returns Buffer
 */
function _A_ASSOCIATE_RQ(): Buffer {
   const P1 = {
      pduType: Buffer.alloc(1, 0x01),
      reserved1: Buffer.alloc(1, 0x00),
      pduLength: Buffer.alloc(4),
   };

   const P2 = {
      pVersion: makeProtocolVersionBuffer(),
      reserved2: Buffer.alloc(2, 0x00),
      calledAET: padAetRight("MY_SCP", MAX_AET_LEN),
      callingAET: padAetRight("MY_SCU", MAX_AET_LEN),
      reserved3: Buffer.alloc(32, 0x00),
      variableItems: makeAppCtx(),
   };

   const bufPart2 = Buffer.concat(Object.values(P2)); // P2 first to get len

   P1.pduLength.writeUInt32BE(bufPart2.length, 0); // now add the length into part1

   const bufPart1 = Buffer.concat(Object.values(P1));
   const totalMsg = Buffer.concat([bufPart1, bufPart2]); // now concat P1 & P2

   return totalMsg;
}

/**
 * Creates a buffer with the Application Context Item.
 * @returns Buffer
 */
function makeAppCtx(): Buffer {
   const appCtx = {
      itemType: Buffer.alloc(1, 0x10),
      reserved: Buffer.alloc(1, 0x00),
      itemLength: Buffer.alloc(2),
   };

   const applicationContextName = encodeDicomUid("1.2.840.123456.1.21.4");
   appCtx.itemLength.writeUint16LE(applicationContextName.length);

   return Buffer.concat(Object.values(appCtx));
}

function makePresCtxItems(): Buffer {
   return;
}

function makeUserInfoItem(): Buffer {
   return;
}

/**
 * Creates a buffer with the protocol version.
 * @returns Buffer
 */
function makeProtocolVersionBuffer(): Buffer {
   const protocolVersion = Buffer.alloc(2);
   protocolVersion.writeUInt16BE(0x0001, 0);
   return protocolVersion;
}

/**
 * Encodes a UID string into a DICOM UID format.
 * @param uid
 * @returns Buffer
 */
function encodeDicomUid(uid: string): Buffer {
   const components = uid.split(".");
   const delimiter = () => Buffer.from(".");

   let buf: Buffer = Buffer.alloc(0);

   for (let i = 0; i < components.length; i++) {
      const cBuf = Buffer.from(components[i]);
      i < components.length - 1
         ? (buf = Buffer.concat([buf, cBuf, delimiter()]))
         : (buf = Buffer.concat([buf, cBuf]));
   }

   return buf; // dicom.nema.org/medical/dicom/current/output/chtml/part08/chapter_F.html
}

/**
 * Create a buffer from string and padd with
 * spacer bytes to the desired length (0x20)
 * @param string
 * @param len
 * @returns Buffer
 */
function padAetRight(string: string, len: number): Buffer {
   let buf = Buffer.from(string);

   if (buf.length > len) {
      buf = buf.subarray(0, len);
   }

   if (buf.length < len) {
      const spaceByte = 0x20;
      const dif = len - buf.length;
      const padding = Buffer.alloc(dif, spaceByte);
      buf = Buffer.concat([buf, padding]);
   }

   return buf;
}

function sendTcpRequest(host: string, port: number, message: string | Buffer, callback: Function) {
   const client = new net.Socket();

   client.connect(port, host, () => {
      console.log("Connected to server");
      client.write(message);
   });

   client.on("data", data => {
      console.log("Received: " + data.toString());
      callback(data.toString());
      client.destroy();
   });

   client.on("error", err => {
      console.error("Error: " + err.message);
      callback(null, err);
   });

   client.on("close", () => {
      console.log("Connection closed");
   });
}
