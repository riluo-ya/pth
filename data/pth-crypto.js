/* ============================================================
 * PTH 题库解密兼容层（pth-crypto.js）
 * ------------------------------------------------------------
 * 解决：http:// 下浏览器不开放 crypto.subtle（Web Crypto 只在
 *       https / localhost / file 的安全上下文里可用），而导航页、
 *       答题页、蓝奏云页都要用它解密 .data 文件。
 *
 * 做法：优先用原生 Web Crypto（快）；不可用时自动切到本文件自带的
 *       纯 JS 实现（PBKDF2-HMAC-SHA256 + AES-256-GCM）。
 *       两者读的是同一种文件格式，不需要重新生成任何 .data：
 *
 *         salt(16) || iv(12) || ciphertext || tag(16)
 *         PBKDF2(password, salt, 100000, SHA-256) → AES-256-GCM key
 *
 * 用法：页面里引一行 <script src="/data/pth-crypto.js"></script>，
 *       然后 await PthCrypto.decrypt(base64, password) 即可。
 *       PthCrypto.encrypt() 也提供了，供数据管理工具加密导出使用。
 *
 * 注意：纯 JS 版 PBKDF2 要跑 10 万轮，首次解密比原生慢一些
 *       （桌面约 0.3~1 秒，手机可能 1~3 秒），属正常现象。
 *       它只是解密公开题库，不改变任何安全边界 —— 密码本来就
 *       明文写在页面里，这层加密从来只防直接翻看，不防开发者。
 * ============================================================ */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.PthCrypto = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    /* ---------------- 基础工具 ---------------- */

    function bytesToB64(bytes) {
        var out = '', chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
            out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        return btoa(out);
    }

    function b64ToBytes(b64) {
        var bin = atob(String(b64).replace(/\s/g, ''));
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function concat() {
        var len = 0, i;
        for (i = 0; i < arguments.length; i++) len += arguments[i].length;
        var out = new Uint8Array(len), off = 0;
        for (i = 0; i < arguments.length; i++) {
            out.set(arguments[i], off);
            off += arguments[i].length;
        }
        return out;
    }

    function wordsToBytes(w) {
        var out = new Uint8Array(w.length * 4);
        var dv = new DataView(out.buffer);
        for (var i = 0; i < w.length; i++) dv.setUint32(i * 4, w[i] >>> 0);
        return out;
    }

    function bytesToWords(b) {
        var out = new Uint32Array(b.length / 4);
        var dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        for (var i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4);
        return out;
    }

    function ctEqual(a, b) {
        if (a.length !== b.length) return false;
        var d = 0;
        for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
        return d === 0;
    }

    /* ---------------- SHA-256 ---------------- */

    var K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);
    var IV = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);

    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    /** 压缩一个 64 字节块，原地累加到 H（8 个 32 位字） */
    function compress(H, W) {
        var w = new Uint32Array(64), i;
        w.set(W);
        for (i = 16; i < 64; i++) {
            var x = w[i - 15], y = w[i - 2];
            var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
            var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3],
            e = H[4], f = H[5], g = H[6], h = H[7];
        for (i = 0; i < 64; i++) {
            var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            var ch = (e & f) ^ ((~e) & g);
            var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
        H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
        H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        return H;
    }

    /** 从「已处理若干完整块」的中间状态继续算完整个 SHA-256 */
    function hashFromState(state0, tail, totalLenBytes) {
        var H = Uint32Array.from(state0);
        var padLen = Math.ceil((tail.length + 9) / 64) * 64;
        var buf = new Uint8Array(padLen);
        buf.set(tail);
        buf[tail.length] = 0x80;
        var bits = totalLenBytes * 8;
        var dv = new DataView(buf.buffer);
        dv.setUint32(padLen - 8, Math.floor(bits / 0x100000000));
        dv.setUint32(padLen - 4, bits >>> 0);
        for (var off = 0; off < padLen; off += 64) {
            var W = bytesToWords(buf.subarray(off, off + 64));
            compress(H, W);
        }
        return H;
    }

    function sha256(bytes) {
        var H = Uint32Array.from(IV);
        var padLen = Math.ceil((bytes.length + 9) / 64) * 64;
        var buf = new Uint8Array(padLen);
        buf.set(bytes);
        buf[bytes.length] = 0x80;
        var bits = bytes.length * 8;
        var dv = new DataView(buf.buffer);
        dv.setUint32(padLen - 8, Math.floor(bits / 0x100000000));
        dv.setUint32(padLen - 4, bits >>> 0);
        for (var off = 0; off < padLen; off += 64) {
            compress(H, bytesToWords(buf.subarray(off, off + 64)));
        }
        return wordsToBytes(H);
    }

    /* ---------------- HMAC-SHA256（预计算 ipad / opad 状态，快很多） ---------------- */

    function hmacStates(key) {
        if (key.length > 64) key = sha256(key);
        var ipad = new Uint8Array(64), opad = new Uint8Array(64), i;
        for (i = 0; i < 64; i++) { ipad[i] = 0x36; opad[i] = 0x5c; }
        for (i = 0; i < key.length; i++) { ipad[i] ^= key[i]; opad[i] ^= key[i]; }
        return {
            ipad: compress(Uint32Array.from(IV), bytesToWords(ipad)),
            opad: compress(Uint32Array.from(IV), bytesToWords(opad))
        };
    }

    function hmac(msg, st) {
        var inner = hashFromState(st.ipad, msg, 64 + msg.length);
        var outer = hashFromState(st.opad, wordsToBytes(inner), 64 + 32);
        return wordsToBytes(outer);
    }

    /* ---------------- PBKDF2-HMAC-SHA256 ---------------- */

    function pbkdf2(passwordBytes, salt, iterations, dkLen) {
        var st = hmacStates(passwordBytes);
        var u1 = new Uint8Array(salt.length + 4);
        u1.set(salt);
        new DataView(u1.buffer).setUint32(salt.length, 1, false); // INT_32_BE(1)
        var U = hmac(u1, st);
        var T = Uint8Array.from(U);
        for (var i = 1; i < iterations; i++) {
            U = hmac(U, st);
            for (var j = 0; j < 32; j++) T[j] ^= U[j];
        }
        return T.slice(0, dkLen); // 本项目 dkLen=32，只需第一个块
    }

    /* ---------------- AES-256 ---------------- */

    function gfMul(a, b) {
        var r = 0;
        for (var i = 0; i < 8; i++) {
            if (b & 1) r ^= a;
            var hi = a & 0x80;
            a = (a << 1) & 0xff;
            if (hi) a ^= 0x1b;
            b >>>= 1;
        }
        return r & 0xff;
    }

    function gfInv(a) {
        if (!a) return 0;
        for (var i = 1; i < 256; i++) if (gfMul(a, i) === 1) return i;
        return 0;
    }

    var SBOX = (function () {
        var s = new Uint8Array(256);
        for (var a = 0; a < 256; a++) {
            var inv = gfInv(a), r = inv;
            for (var c = 1; c <= 4; c++) r ^= ((inv << c) | (inv >>> (8 - c))) & 0xff;
            s[a] = (r ^ 0x63) & 0xff;
        }
        return s;
    })();

    function xtime(a) { return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff; }

    function subWord(w) {
        return ((SBOX[(w >>> 24) & 255] << 24) |
                (SBOX[(w >>> 16) & 255] << 16) |
                (SBOX[(w >>> 8) & 255] << 8) |
                SBOX[w & 255]) | 0;
    }

    function keyExpansion(key) {
        var w = new Uint32Array(60), i;
        var dv = new DataView(key.buffer, key.byteOffset, key.byteLength);
        for (i = 0; i < 8; i++) w[i] = dv.getUint32(i * 4);
        var rcon = 1;
        for (i = 8; i < 60; i++) {
            var t = w[i - 1];
            if (i % 8 === 0) {
                t = ((t << 8) | (t >>> 24)) | 0;   // RotWord
                t = subWord(t);
                t = (t ^ (rcon << 24)) | 0;
                rcon = xtime(rcon);
            } else if (i % 8 === 4) {
                t = subWord(t);
            }
            w[i] = (w[i - 8] ^ t) | 0;
        }
        return w;
    }

    function addRoundKey(s, w, round) {
        for (var c = 0; c < 4; c++) {
            var k = w[round * 4 + c];
            s[4 * c + 0] ^= (k >>> 24) & 255;
            s[4 * c + 1] ^= (k >>> 16) & 255;
            s[4 * c + 2] ^= (k >>> 8) & 255;
            s[4 * c + 3] ^= k & 255;
        }
    }

    function encryptBlock(block, w) {
        var s = Uint8Array.from(block), r, i, tmp;
        addRoundKey(s, w, 0);
        for (r = 1; r <= 13; r++) {
            for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
            // ShiftRows：state[r + 4c] = s[4c + r]，行 r 循环左移 r 列
            tmp = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = tmp;
            tmp = s[2]; s[2] = s[10]; s[10] = tmp;
            tmp = s[6]; s[6] = s[14]; s[14] = tmp;
            tmp = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = tmp;
            // MixColumns
            for (var c = 0; c < 4; c++) {
                var o = 4 * c;
                var a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
                var all = a0 ^ a1 ^ a2 ^ a3;
                s[o]     = a0 ^ all ^ xtime(a0 ^ a1);
                s[o + 1] = a1 ^ all ^ xtime(a1 ^ a2);
                s[o + 2] = a2 ^ all ^ xtime(a2 ^ a3);
                s[o + 3] = a3 ^ all ^ xtime(a3 ^ a0);
            }
            addRoundKey(s, w, r);
        }
        for (i = 0; i < 16; i++) s[i] = SBOX[s[i]];
        tmp = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = tmp;
        tmp = s[2]; s[2] = s[10]; s[10] = tmp;
        tmp = s[6]; s[6] = s[14]; s[14] = tmp;
        tmp = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = tmp;
        addRoundKey(s, w, 14);
        return s;
    }

    /* ---------------- GCM（GHASH + CTR） ---------------- */

    function gmul(X, Y) {
        var Z = new Uint8Array(16), V = Uint8Array.from(Y), i, j;
        for (i = 0; i < 128; i++) {
            if ((X[i >> 3] >>> (7 - (i & 7))) & 1) {
                for (j = 0; j < 16; j++) Z[j] ^= V[j];
            }
            var lsb = V[15] & 1;
            for (j = 15; j > 0; j--) V[j] = ((V[j] >>> 1) | ((V[j - 1] & 1) << 7)) & 255;
            V[0] = V[0] >>> 1;
            if (lsb) V[0] ^= 0xe1;
        }
        return Z;
    }

    function ghash(H, C) {
        var Y = new Uint8Array(16), off, j;
        for (off = 0; off + 16 <= C.length; off += 16) {
            var X = new Uint8Array(16);
            for (j = 0; j < 16; j++) X[j] = Y[j] ^ C[off + j];
            Y = gmul(X, H);
        }
        var rem = C.length - off;
        if (rem) {
            var X2 = new Uint8Array(16);
            for (j = 0; j < 16; j++) X2[j] = Y[j];
            for (j = 0; j < rem; j++) X2[j] ^= C[off + j];
            Y = gmul(X2, H);
        }
        // 长度块：AAD 长度 0（高 64 位）|| C 的比特长度（低 64 位）
        var L = new Uint8Array(16), bits = C.length * 8;
        var dv = new DataView(L.buffer);
        dv.setUint32(8, Math.floor(bits / 0x100000000));
        dv.setUint32(12, bits >>> 0);
        var X3 = new Uint8Array(16);
        for (j = 0; j < 16; j++) X3[j] = Y[j] ^ L[j];
        return gmul(X3, H);
    }

    function inc32(ctr) {
        for (var i = 15; i >= 12; i--) {
            ctr[i] = (ctr[i] + 1) & 255;
            if (ctr[i] !== 0) break;
        }
    }

    function aesGcmDecrypt(key, iv, ctAndTag) {
        var w = keyExpansion(key);
        var H = encryptBlock(new Uint8Array(16), w);
        var J0 = new Uint8Array(16);
        J0.set(iv);
        J0[15] = 1; // 12 字节 IV → J0 = IV || 0x00000001
        if (ctAndTag.length < 16) throw new Error('加密数据格式错误');
        var C = ctAndTag.subarray(0, ctAndTag.length - 16);
        var tag = ctAndTag.subarray(ctAndTag.length - 16);
        var expected = encryptBlock(J0, w);
        var S = ghash(H, C);
        for (var i = 0; i < 16; i++) expected[i] ^= S[i];
        if (!ctEqual(expected, tag)) {
            throw new Error('AES-GCM 认证失败：密码错误或数据已损坏');
        }
        var out = new Uint8Array(C.length), ctr = Uint8Array.from(J0);
        for (var off = 0; off < C.length; off += 16) {
            inc32(ctr);
            var ks = encryptBlock(ctr, w);
            var n = Math.min(16, C.length - off);
            for (var j = 0; j < n; j++) out[off + j] = C[off + j] ^ ks[j];
        }
        return out;
    }

    function aesGcmEncrypt(key, iv, plain) {
        var w = keyExpansion(key);
        var H = encryptBlock(new Uint8Array(16), w);
        var J0 = new Uint8Array(16);
        J0.set(iv); J0[15] = 1;
        var C = new Uint8Array(plain.length), ctr = Uint8Array.from(J0);
        for (var off = 0; off < plain.length; off += 16) {
            inc32(ctr);
            var ks = encryptBlock(ctr, w);
            var n = Math.min(16, plain.length - off);
            for (var j = 0; j < n; j++) C[off + j] = plain[off + j] ^ ks[j];
        }
        var tag = encryptBlock(J0, w), S = ghash(H, C);
        for (var i = 0; i < 16; i++) tag[i] ^= S[i];
        return concat(C, tag);
    }

    /* ---------------- 对外接口 ---------------- */

    function nativeAvailable() {
        return typeof crypto !== 'undefined' && !!crypto.subtle &&
            typeof TextEncoder !== 'undefined' && typeof TextDecoder !== 'undefined';
    }

    function randomBytes(n) {
        var out = new Uint8Array(n);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(out);
        } else {
            for (var i = 0; i < n; i++) out[i] = (Math.random() * 256) | 0;
        }
        return out;
    }

    /** 纯 JS 解密一条 .data，返回明文字节 */
    function jsDecryptBytes(data, password) {
        if (data.length < 44) throw new Error('加密数据格式错误：数据太短');
        var salt = data.subarray(0, 16), iv = data.subarray(16, 28),
            ct = data.subarray(28);
        var pwd = new TextEncoder().encode(password);

        // .data 文件是固定的，salt 也就固定。把派生结果缓存在 sessionStorage，
        // 首次约 1~2 秒，之后同标签页内再进任何页面都是秒开。
        // 缓存键含 salt + 密码的哈希，换密码不会命中旧 key。
        var cacheKey = 'pth_key_' + hexOf(sha256(concat(salt, pwd))).slice(0, 24);
        var key = null;
        try {
            var cached = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(cacheKey) : null;
            if (cached && cached.length === 64) key = hexToBytes(cached);
        } catch (e) { /* 隐私模式禁用 storage，忽略 */ }

        if (!key) {
            key = pbkdf2(pwd, salt, 100000, 32);
            try {
                if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(cacheKey, hexOf(key));
            } catch (e) { /* 忽略 */ }
        }
        return aesGcmDecrypt(key, iv, ct);
    }

    function hexOf(b) {
        var s = '';
        for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
        return s;
    }
    function hexToBytes(h) {
        var out = new Uint8Array(h.length / 2);
        for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
        return out;
    }

    /** 解密 .data（Base64）→ 明文字符串；优先原生，http 下自动走纯 JS */
    async function decrypt(b64, password) {
        var data = b64ToBytes(b64);
        if (nativeAvailable()) {
            var enc = new TextEncoder();
            var km = await crypto.subtle.importKey(
                'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
            var key = await crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: data.subarray(0, 16), iterations: 100000, hash: 'SHA-256' },
                km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
            var dec = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: data.subarray(16, 28) }, key, data.subarray(28));
            return new TextDecoder().decode(new Uint8Array(dec));
        }
        if (typeof console !== 'undefined' && console.info) {
            console.info('[pth-crypto] 当前环境未开放 Web Crypto（http），改用纯 JS 解密，首次可能稍慢…');
        }
        // PBKDF2 是同步计算，先让出一帧让页面把「正在解密」画出来，
        // 否则用户会看到界面直接冻住 1~2 秒。
        await new Promise(function (r) {
            if (typeof setTimeout !== 'undefined') setTimeout(r, 0);
            else r();
        });
        var t0 = Date.now();
        var plain = jsDecryptBytes(data, password);
        if (typeof console !== 'undefined' && console.info) {
            console.info('[pth-crypto] 纯 JS 解密完成，用时 ' + (Date.now() - t0) + ' ms');
        }
        return new TextDecoder().decode(plain);
    }

    /** 加密明文 → Base64 .data；https 走原生，http 走纯 JS */
    async function encrypt(plainText, password) {
        var salt = randomBytes(16), iv = randomBytes(12);
        var plain = new TextEncoder().encode(plainText);
        var out;
        if (nativeAvailable()) {
            var km = await crypto.subtle.importKey(
                'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
            var key = await crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
                km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
            var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain);
            out = concat(salt, iv, new Uint8Array(ct));
        } else {
            var k = pbkdf2(new TextEncoder().encode(password), salt, 100000, 32);
            out = concat(salt, iv, aesGcmEncrypt(k, iv, plain));
        }
        return bytesToB64(out);
    }

    /** http 环境下自动往 #loading-overlay 加一句提示，免得用户以为卡死 */
    function installLoadingHint() {
        if (nativeAvailable() || typeof document === 'undefined') return;
        function add() {
            var host = document.getElementById('loading-overlay');
            if (!host || document.getElementById('pth-http-hint')) return;
            var p = document.createElement('div');
            p.id = 'pth-http-hint';
            p.textContent = '首次解密数据约需 1~2 秒，请稍等…';
            p.style.cssText = 'margin-top:14px;padding:0 16px;color:#94a3b8;' +
                'font-size:13px;text-align:center;line-height:1.6;';
            host.appendChild(p);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', add);
        } else {
            add();
        }
    }
    installLoadingHint();

    return {
        decrypt: decrypt,
        encrypt: encrypt,
        isNativeAvailable: nativeAvailable,
        /** 当前会走哪条路径：'native'（https）或 'js'（http） */
        mode: function () { return nativeAvailable() ? 'native' : 'js'; },
        version: '1.0.0',
        /* 仅供测试/调试 */
        _jsDecryptBytes: jsDecryptBytes,
        _sha256: sha256,
        _pbkdf2: pbkdf2,
        _aesGcmEncrypt: aesGcmEncrypt
    };
});
