const hex = 0x2a;
const buf = Buffer.alloc(1);

buf.writeUint8(hex);

console.log(buf.toString("ascii"));
