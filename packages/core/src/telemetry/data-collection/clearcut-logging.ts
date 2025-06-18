import { Buffer } from 'buffer';
import * as https from 'https';

export interface LogResponse {
  nextRequestWaitMs?: number;
}

export function fixBuf<T>(toFix: T): T | [T] {
  return [toFix];
}

export function postTestLogMessage(): Promise<LogResponse> {
    const message = buildTestLogMessage();    
    return postToClearcut(message);
}

export function buildTestLogMessage(): string {
  const event = {
      console_type: "desktop",
      event_name: "test_action",
      client_email: "foo@bar.com",
      event_metadata: [] as object[],
    } as any;

    const eventString = JSON.stringify(event);
    const exp = fixBuf({ gws_experiment: [] });
    const events: any = [];
    events.push(
      fixBuf({
        event_time_ms: Date.now(),
        source_extension_json: eventString,
        exp,
      })
    );

    const request = fixBuf({
      client_info: fixBuf({
        client_type: 'DESKTOP',
        desktop_client_info: fixBuf({ os: "MAC" }),
      }),
      log_source_name: 'CONCORD',
      request_time_ms: Date.now(),
      log_event: events,
    });

    return JSON.stringify(request);
}

export async function postToClearcut(
  body: string
): Promise<LogResponse> {
  return new Promise<Buffer>((resolve, reject) => {
    const options = {
      hostname: 'play.googleapis.com',
      path: '/log',
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body) },
    };

    const bufs: Buffer[] = [];
    const req = https.request(options, res => {
      res.on('data', buf => bufs.push(buf));
      res.on('end', () => {
        resolve(Buffer.concat(bufs));
      });
    });
    req.on('error', e => {
      reject(e);
    });
    req.end(body);
  }).then((buf: Buffer) => {
    try {
      return decodeLogResponse(buf) || {};
    } catch {
      return {};
    }
  });
}

// Visible for testing. Decodes protobuf-encoded response from Clearcut server.
export function decodeLogResponse(buf: Buffer): LogResponse | undefined {
  if (buf.length < 1) {
    return undefined;
  }

  // The first byte of the buffer is `field<<3 | type`. We're looking for field
  // 1, with type varint, represented by type=0. If the first byte isn't 8, that
  // means field 1 is missing or the message is corrupted. Either way, we return
  // undefined.
  if (buf.readUInt8(0) !== 8) {
    return undefined;
  }

  let ms = BigInt(0);
  let cont = true;

  // In each byte, the most significant bit is the continuation bit. If it's
  // set, we keep going. The lowest 7 bits, are data bits. They are concatenated
  // in reverse order to form the final number.
  for (let i = 1; cont && i < buf.length; i++) {
    const byte = buf.readUInt8(i);
    ms |= BigInt(byte & 0x7f) << BigInt(7 * (i - 1));
    cont = (byte & 0x80) !== 0;
  }

  if (cont) {
    // We have fallen off the buffer without seeing a terminating byte. The
    // message is corrupted.
    return undefined;
  }
  return {
    nextRequestWaitMs: Number(ms),
  };
}