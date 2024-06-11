import { Headers } from 'undici';
import { HttpRequest, InvocationContext } from "@azure/functions";
import { verifyAccessToken } from './authentication';


export async function parseHeaders(headers: Headers, context: InvocationContext): Promise<{[key:string]:string[]}> {
    const headersObject: {[key:string]:string[]} = {};
    headers.forEach((value, key) => {
        if (!Array.isArray(headersObject[key])) {
            headersObject[key] = [];
        }
        headersObject[key].push(value);
        context.log(`Header => ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    });
    return Promise.resolve(headersObject);
}

async function extractBearerToken(request: HttpRequest, context: InvocationContext): Promise<string|undefined> {
    const headers = await parseHeaders(request.headers, context);
    const token = headers['authorization']?.[0]
    if (token) context.log(`Extracted token from authorization header: ${token}`);
    return token
}

async function extractAccessTokenFromCookie(request: HttpRequest, context: InvocationContext): Promise<string|undefined> {
    const headers = await parseHeaders(request.headers, context);
    const cookies: string[]|undefined = headers['cookie'];
    if (!cookies) return undefined;
    const cookie = cookies.find(c => c.match(/accesstoken=([^;]*)/))
    const token = cookie ? cookie.slice('accesstoken='.length) : undefined;
    if (token) context.log(`Extracted token from cookie: ${token}`);
    return token
}

function extractAccessTokenFromQueryString(request: HttpRequest, context: InvocationContext): string|undefined {
    const token = request.query.get('token');
    if (token) context.log(`Extracted token from query string: ${token}`);
    return token
}

export async function getAccessToken(request: HttpRequest, context: InvocationContext): Promise<string|null> {
    const token = extractAccessTokenFromQueryString(request, context) || await extractBearerToken(request, context) || await extractAccessTokenFromCookie(request, context);
    const decoded = verifyAccessToken(token);
    if (!decoded) {
        context.log('Invalid token');
        return null;
    }
    context.log(`Valid token: ${JSON.stringify(decoded)}`);
    return token;
}
