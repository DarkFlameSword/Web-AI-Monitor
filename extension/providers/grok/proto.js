/**
 * Just enough protobuf and gRPC-web for the one billing call grok.com's own
 * usage page makes: read a message's fields by number, and cut a message
 * down to the fields the extension reads. Nothing here throws.
 */

/**
 * The fields of a protobuf message, in order. A field's value is a number
 * (varint, 32- or 64-bit float) or the bytes of a length-delimited field;
 * raw is the whole field, tag included. Reading stops at the first field
 * that does not decode.
 *
 * @param {Uint8Array} bytes
 * @returns {{number: number, wire: number, value: number|Uint8Array, raw: Uint8Array}[]}
 */
export function protoFields(bytes) {
  const fields = [];
  if (!(bytes instanceof Uint8Array)) return fields;
  let at = 0;
  const varint = () => {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 10 && at < bytes.length; i += 1) {
      const byte = bytes[at++];
      value += (byte & 0x7f) * scale;
      if (!(byte & 0x80)) return value;
      scale *= 128;
    }
    return null;
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at < bytes.length) {
    const start = at;
    const key = varint();
    if (key === null || key < 8) break;
    const number = Math.floor(key / 8);
    const wire = key % 8;
    let value;
    if (wire === 0) {
      value = varint();
      if (value === null) break;
    } else if (wire === 1) {
      if (at + 8 > bytes.length) break;
      value = view.getFloat64(at, true);
      at += 8;
    } else if (wire === 2) {
      const length = varint();
      if (length === null || at + length > bytes.length) break;
      value = bytes.subarray(at, at + length);
      at += length;
    } else if (wire === 5) {
      if (at + 4 > bytes.length) break;
      value = view.getFloat32(at, true);
      at += 4;
    } else {
      break;
    }
    fields.push({ number, wire, value, raw: bytes.subarray(start, at) });
  }
  return fields;
}

/** The value of the first field with that number, or undefined. */
export function fieldValue(fields, number) {
  return fields.find(field => field.number === number)?.value;
}

/** A google.protobuf.Timestamp as ISO, or null when it is not a plausible one. */
export function timestampOf(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const seconds = fieldValue(protoFields(bytes), 1);
  // 2017 to 2039: anything else is not a time this call reports.
  if (typeof seconds !== 'number' || seconds < 1.5e9 || seconds > 2.2e9) return null;
  return new Date(seconds * 1000).toISOString();
}

export function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function varintBytes(value) {
  const out = [];
  let rest = Math.max(0, Math.floor(value));
  do {
    const low = rest % 128;
    rest = Math.floor(rest / 128);
    out.push(rest ? low | 0x80 : low);
  } while (rest);
  return Uint8Array.from(out);
}

/** A length-delimited field: tag, length, then the bytes. */
export function lengthField(number, bytes) {
  return concatBytes([varintBytes(number * 8 + 2), varintBytes(bytes.length), bytes]);
}

/** The message with only the fields whose numbers are listed, as they were. */
export function keepFields(bytes, numbers) {
  return concatBytes(protoFields(bytes).filter(field => numbers.includes(field.number)).map(field => field.raw));
}

/** A gRPC-web data frame around a message: flag 0, its length (4 bytes, big-endian), the message. */
export function grpcFrame(message) {
  const out = new Uint8Array(5 + message.length);
  new DataView(out.buffer).setUint32(1, message.length, false);
  out.set(message, 5);
  return out;
}

/**
 * The message in a gRPC-web reply: its first data frame. Trailer frames
 * (flag 0x80) only carry the call's status. Null when there is none.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint8Array|null}
 */
export function grpcMessage(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (at + 5 <= bytes.length) {
    const flag = bytes[at];
    const length = view.getUint32(at + 1, false);
    if (at + 5 + length > bytes.length) return null;
    const body = bytes.subarray(at + 5, at + 5 + length);
    at += 5 + length;
    if (!(flag & 0x80)) return body;
  }
  return null;
}
