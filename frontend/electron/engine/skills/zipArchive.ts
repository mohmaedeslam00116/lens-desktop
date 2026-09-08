/**
 * LENS Pure Node.js Zero-Dependency PKZIP Archiver & Decompressor
 * Tracer 9 (Issue #36): Provides byte-for-byte portable .zip archive generation
 * and extraction using Node's standard node:zlib, without any native C++ dependencies.
 * Includes Zip-Slip directory traversal prevention and proprietary file exclusion.
 */

import * as zlib from 'zlib';
import * as path from 'path';

// Standard 32-bit CRC-32 calculation table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

export function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  relativePath: string;
  content: Buffer;
}

export interface ZipArchiveFile {
  relativePath: string;
  content: Buffer | string;
}

/**
 * Creates a standard, portable PKZIP 2.0 archive buffer in pure Node.js.
 * Automatically filters out system, git, and proprietary secrets.
 */
export function createZipArchive(files: ZipArchiveFile[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let currentOffset = 0;

  // Filter out system and proprietary files
  const filteredFiles = files.filter((f) => {
    const norm = f.relativePath.replace(/\\/g, '/').toLowerCase();
    const base = path.posix.basename(norm);
    if (norm.startsWith('.git/') || norm === '.git' || norm.includes('/.git/')) return false;
    if (base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini') return false;
    if (base.startsWith('.env') || base.includes('secret') || base.includes('id_rsa')) return false;
    return true;
  });

  for (const file of filteredFiles) {
    const rawContent = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf8');

    const cleanPath = file.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const pathBytes = Buffer.from(cleanPath, 'utf8');
    const crc = computeCrc32(rawContent);

    // Deflate raw chunk (no zlib headers)
    const deflated = zlib.deflateRawSync(rawContent, { level: 9 });
    // If deflated isn't smaller, store uncompressed (method 0) vs deflated (method 8)
    const useDeflate = deflated.length < rawContent.length;
    const compressionMethod = useDeflate ? 8 : 0;
    const compressedData = useDeflate ? deflated : rawContent;

    const modTime = new Date();
    const dosTime =
      (modTime.getHours() << 11) |
      (modTime.getMinutes() << 5) |
      (modTime.getSeconds() >> 1);
    const dosDate =
      ((modTime.getFullYear() - 1980) << 9) |
      ((modTime.getMonth() + 1) << 5) |
      modTime.getDate();

    // 1. Local File Header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + pathBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);          // Version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6);      // General purpose flags: UTF-8 filename (bit 11)
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawContent.length, 22);
    localHeader.writeUInt16LE(pathBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);          // Extra field length
    pathBytes.copy(localHeader, 30);

    localChunks.push(localHeader, compressedData);

    // 2. Central Directory Header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46 + pathBytes.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central header signature
    centralHeader.writeUInt16LE(20, 4);          // Version made by: 2.0
    centralHeader.writeUInt16LE(20, 6);          // Version needed to extract: 2.0
    centralHeader.writeUInt16LE(0x0800, 8);      // General purpose flags: UTF-8
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(rawContent.length, 24);
    centralHeader.writeUInt16LE(pathBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);          // Extra field length
    centralHeader.writeUInt16LE(0, 32);          // File comment length
    centralHeader.writeUInt16LE(0, 34);          // Disk number start
    centralHeader.writeUInt16LE(0, 36);          // Internal file attributes
    centralHeader.writeUInt32LE(0, 38);          // External file attributes
    centralHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header
    pathBytes.copy(centralHeader, 46);

    centralChunks.push(centralHeader);

    currentOffset += localHeader.length + compressedData.length;
  }

  const centralDirectoryOffset = currentOffset;
  let centralDirectorySize = 0;
  for (const c of centralChunks) {
    centralDirectorySize += c.length;
  }

  // 3. End of Central Directory Record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);                  // EOCD signature
  eocd.writeUInt16LE(0, 4);                           // Number of this disk
  eocd.writeUInt16LE(0, 6);                           // Disk where central directory starts
  eocd.writeUInt16LE(filteredFiles.length, 8);         // Number of central directory records on this disk
  eocd.writeUInt16LE(filteredFiles.length, 10);        // Total number of central directory records
  eocd.writeUInt32LE(centralDirectorySize, 12);       // Size of central directory
  eocd.writeUInt32LE(centralDirectoryOffset, 16);     // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                          // Comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

/**
 * Extracts a standard PKZIP archive buffer in-memory.
 * Strictly verifies against Zip-Slip path traversal attacks.
 */
export function readZipArchive(zipBuffer: Buffer): ZipEntry[] {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw new Error('INVALID_ZIP_ARCHIVE: Buffer is too small to be a valid ZIP archive');
  }

  // 1. Locate End of Central Directory (EOCD) signature from the end of the buffer
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('INVALID_ZIP_ARCHIVE: End of Central Directory record not found');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  const entries: ZipEntry[] = [];
  let currentCdOffset = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (currentCdOffset + 46 > zipBuffer.length) {
      throw new Error('INVALID_ZIP_ARCHIVE: Corrupted Central Directory entry');
    }

    if (zipBuffer.readUInt32LE(currentCdOffset) !== 0x02014b50) {
      throw new Error(`INVALID_ZIP_ARCHIVE: Missing central header signature at offset ${currentCdOffset}`);
    }

    const compressionMethod = zipBuffer.readUInt16LE(currentCdOffset + 10);
    const compressedSize = zipBuffer.readUInt32LE(currentCdOffset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(currentCdOffset + 24);
    const nameLength = zipBuffer.readUInt16LE(currentCdOffset + 28);
    const extraLength = zipBuffer.readUInt16LE(currentCdOffset + 30);
    const commentLength = zipBuffer.readUInt16LE(currentCdOffset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(currentCdOffset + 42);

    const relativePath = zipBuffer.toString('utf8', currentCdOffset + 46, currentCdOffset + 46 + nameLength);

    // Zip Slip defense
    const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
    if (
      normalized.startsWith('/') ||
      normalized.startsWith('../') ||
      normalized === '..' ||
      normalized.includes('/../')
    ) {
      throw new Error(`SECURITY_ACCESS_DENIED: Zip-Slip traversal attempt detected: "${relativePath}"`);
    }

    // Skip directory entries (trailing slash)
    if (!normalized.endsWith('/')) {
      // Read data from local file header
      if (localHeaderOffset + 30 > zipBuffer.length) {
        throw new Error('INVALID_ZIP_ARCHIVE: Corrupt local file header offset');
      }

      const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd > zipBuffer.length) {
        throw new Error('INVALID_ZIP_ARCHIVE: Compressed payload exceeds buffer bounds');
      }

      const compressedChunk = zipBuffer.subarray(dataStart, dataEnd);
      let content: Buffer;

      if (compressionMethod === 8) {
        content = zlib.inflateRawSync(compressedChunk);
      } else if (compressionMethod === 0) {
        content = Buffer.from(compressedChunk);
      } else {
        throw new Error(`UNSUPPORTED_COMPRESSION: Compression method ${compressionMethod} is not supported`);
      }

      if (content.length !== uncompressedSize) {
        throw new Error(`CORRUPT_PAYLOAD: Uncompressed size mismatch (${content.length} vs expected ${uncompressedSize})`);
      }

      entries.push({
        relativePath: normalized,
        content
      });
    }

    currentCdOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
