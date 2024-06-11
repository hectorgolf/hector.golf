import { Headers } from 'undici';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getAccessToken } from '../utils/request-processing';
import { generateAccessToken } from '../utils/authentication';

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

    const reqHeaders = await parseHeaders(request.headers, context);
    const bodyString = await request.text()
    const bodyJson = JSON.parse(bodyString)

    context.log(`Request headers: ${JSON.stringify(reqHeaders)}`)
    context.log(`Request body as String: ${JSON.stringify(bodyString)}`)
    context.log(`Request body as JSON:   ${JSON.stringify(bodyJson)}`)

    const name = bodyJson.thisis || request.query.get('name') || bodyString || 'world';

    let expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 30);

    var accessToken = generateAccessToken(name);
    let accessCookieConfig = `accesstoken=${accessToken}; Expires=${expiryDate.toUTCString()};`
    accessCookieConfig += ' HttpOnly;'
    accessCookieConfig += ' Secure;'

    const token = await getAccessToken(request, context)
    if (!token) {
        return {
            body: `You're not logged in, ${name}! Here's a token inside a cookie for you: ${accessToken}`,
            headers: {
                'Set-Cookie': accessCookieConfig
            }
        };
    } else {
        return {
            body: `Hello, ${name}! You're already logged in - no cookie for you!`
        };
    }
};

app.http('sayHello', {
    methods: ['GET', 'POST'],
    route: 'hi/{name:alpha?}',
    authLevel: 'anonymous',
    handler: sayHello
});
