import { Headers } from 'undici';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {sign, verify} from 'jsonwebtoken';
import { getAccessToken } from '../utils/request-processing';

const jwtSharedSecret = process.env.JWT_SHARED_SECRET;

async function parseHeaders(headers: Headers, context: InvocationContext): Promise<{[key:string]:string[]}> {
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

export async function sayHello(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log(`Http function processed request for url "${request.url}" (${request.method})`);

    const token = await getAccessToken(request, context)
    // invalid token - synchronous

    const reqHeaders = await parseHeaders(request.headers, context);
    const bodyString = await request.text()
    const bodyJson = JSON.parse(bodyString)

    context.log(`Request headers: ${JSON.stringify(reqHeaders)}`)
    context.log(`Request body as String: ${JSON.stringify(bodyString)}`)
    context.log(`Request body as JSON:   ${JSON.stringify(bodyJson)}`)

    const name = bodyJson.thisis || request.query.get('name') || bodyString || 'world';

    let expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    var accessToken = sign({ user: name }, jwtSharedSecret);
    let accessCookieConfig = `accesstoken=${accessToken}; Expires=${expiryDate.toUTCString()};`
    accessCookieConfig += ' HttpOnly;'
    accessCookieConfig += ' Secure;'

    return {
        body: `Hello, ${name}!`,
        headers: {
            'Set-Cookie': accessCookieConfig
        }
    };
};

app.http('sayHello', {
    methods: ['GET', 'POST'],
    route: 'hi/{name:alpha?}',
    authLevel: 'anonymous',
    handler: sayHello
});
