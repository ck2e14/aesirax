import net from "net";

// TODO - make the 'variable items' property, which needs:
// 1 Application Context DONE
// 1-n Presentation Context Items:
// 1 Uesr Information Item:

main();
function main() {
   // first define the first part of the message.
   // we split into two parts where the end of the first part will reference the length of the second.
   // the DICOM spec says that in A-ASSOCIATE-RQ messages bytes 3,4,5,6 represent the length of the
   // rest of the message.
   const msgPart1 = {
      pduType: Buffer.alloc(1, 0x01),
      reserved1: Buffer.alloc(1, 0x00),
      pduLength: Buffer.alloc(0),
   };

   const msgPart2 = {
      pVersion: makeProtocolVersionBuffer(),
      reserved2: Buffer.alloc(2, 0x00),
      calledAET: padAetRight("MY_SCP", 16),
      callingAET: padAetRight("MY_SCU", 16),
      reserved3: Buffer.alloc(32, 0x00),
      variableItems: makeAppCtx(),
   };

   // first build the buffer from part 2 so we know its length
   const bufPart2 = Buffer.concat(Object.values(msgPart2));

   // now add the length into part1
   const pduLength = Buffer.alloc(4);
   pduLength.writeUInt32BE(bufPart2.length, 0);
   msgPart1.pduLength = pduLength;

   // now create create a buffer from part 1 and concat with our part 2
   const bufPart1 = Buffer.concat(Object.values(msgPart1));
   const totalMsg = Buffer.concat([bufPart1, bufPart2]);
   console.log(totalMsg);

   sendTcpRequest("127.0.0.1", 8888, totalMsg, (response: any, error: any) => {
      if (error) {
         console.error("Error during communication:", error);
      }
      console.log("Server responded:", response);
   });
}

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

function makeProtocolVersionBuffer(): Buffer {
   const protocolVersion = Buffer.alloc(2);
   protocolVersion.writeUInt16BE(0x0001, 0);
   return protocolVersion;
}

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
      client.destroy(); // kill client after server's response
   });

   client.on("error", err => {
      console.error("Error: " + err.message);
      callback(null, err);
   });

   client.on("close", () => {
      console.log("Connection closed");
   });
}
