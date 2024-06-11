import {sign, decode, verify} from 'jsonwebtoken';

const jwtSharedSecret = process.env.JWT_SHARED_SECRET;

export function generateAccessToken(name: string): string {
    return sign({ user: name }, jwtSharedSecret, { expiresIn: '10m' });
}

export function generateSetCookieHeader(accessToken: string, httpOnly: boolean = true, secure: boolean = true): string {
    decode(accessToken).ex
    let expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);
    let accessCookieConfig = `accesstoken=${accessToken}; Expires=${expiryDate.toUTCString()};`
    if (httpOnly) accessCookieConfig += ' HttpOnly;'
    if (secure) accessCookieConfig += ' Secure;'
    return accessCookieConfig;
}

export function verifyAccessToken(token: string): any|undefined {
    try {
        let decoded = verify(token, jwtSharedSecret, { complete: true });
        return decoded;
    } catch(err) {
        return undefined;
    }
}

export function getExpiryDateFromToken(token: string): Date|undefined {
    try {
        let decoded = decode(token, jwtSharedSecret, { complete: true });
        return decoded.exp ? new Date(decoded.exp * 1000) : undefined;
    } catch(err) {
        return undefined;
    }
}