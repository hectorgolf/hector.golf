import { randomInt, createHash } from 'crypto';
import { Headers, FormData } from 'undici';
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { generateAccessToken, getExpiryDateFromToken } from '../utils/authentication';


async function parseHeaders(headers: Headers, context: InvocationContext): Promise<{[key:string]:string[]}> {
    const headersObject: {[key:string]:string[]} = {};
    headers.forEach((value, key) => {
        if (!Array.isArray(headersObject[key])) {
            headersObject[key] = [];
        }
        headersObject[key].push(value);
        context.debug(`Header => ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    });
    return Promise.resolve(headersObject);
}

function buildSetCookieHeader(accessToken: string, httpOnly: boolean = true, secure: boolean = true): string {
    let expiryDate = getExpiryDateFromToken(accessToken)
    let accessCookieConfig = `accesstoken=${accessToken}; Expires=${expiryDate.toUTCString()};`
    if (httpOnly) accessCookieConfig += ' HttpOnly;'
    if (secure) accessCookieConfig += ' Secure;'
    return accessCookieConfig;
}

type PasswordSubmission = {
    password: string,
    salt: string
}

async function extractPasswordFromFormData(request: HttpRequest, context: InvocationContext): Promise<PasswordSubmission|undefined> {
    const formData: FormData = await request.formData();
    const password = formData.get('password') as string;
    const salt = formData.get('salt') as string;
    if (password && salt) {
        return { password, salt };
    }
    return undefined;
}

async function extractPasswordFromJsonBody(request: HttpRequest, context: InvocationContext): Promise<PasswordSubmission|undefined> {
    const bodyString = await request.text();
    const bodyJson = JSON.parse(bodyString);
    if (bodyJson.password && bodyJson.salt) {
        return bodyJson as PasswordSubmission;
    }
    return undefined;
}

async function extractSubmittedPassword(request: HttpRequest, context: InvocationContext): Promise<PasswordSubmission|undefined> {
    const reqHeaders = await parseHeaders(request.headers, context);
    const requestContentType = reqHeaders['content-type']?.[0] || '';
    if (requestContentType.startsWith('application/json')) {
        return extractPasswordFromJsonBody(request, context);
    } else if (requestContentType.startsWith('application/x-www-form-urlencoded')) {
        return extractPasswordFromFormData(request, context);
    }
    return undefined;
}

function checkSubmittedPassword(password: string, salt: string, context: InvocationContext): boolean {
    const hash = createHash('sha512');
    hash.update(salt);
    hash.update(process.env.PWD_SHARED_SECRET);
    const expectedHash = hash.digest('hex');
    return password.toLowerCase() === expectedHash.toLowerCase();
}

export async function authorize(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.debug(`Authorizing request: "${request.url}" (${request.method})`);
    const { password, salt } = await extractSubmittedPassword(request, context);
    if (checkSubmittedPassword(password, salt, context)) {
        context.debug('Password correct!');
        var accessToken = generateAccessToken('?');
        const accessCookieConfig = buildSetCookieHeader(accessToken, true, false);
        return {
            body: accessToken,
            headers: {
                'Set-Cookie': accessCookieConfig
            }
        };
    } else {
        context.warn('Password incorrect!');
        return {
            body: `Authorization failed.`
        };
    }
};

export async function renderLoginPage(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.debug(`Rendering login page: "${request.url}" (${request.method})`);
    return {
        body: `<!DOCTYPE html>
                <html>
                    <head>
                        <title>Login</title>
                    </head>
                    <body>
                        <script src="https://cdnjs.cloudflare.com/ajax/libs/jsSHA/2.0.2/sha.js"></script>
                        <script type="text/javascript">
                            function onSubmit(obj) {
                                var saltObj = document.getElementById('salt');
                                var pwdObj = document.getElementById('password');
                                var hashObj = new jsSHA("SHA-512", "TEXT", {numRounds: 1});
                                hashObj.update(saltObj.value.trim());
                                hashObj.update(pwdObj.value.trim());
                                var hash = hashObj.getHash("HEX");
                                pwdObj.value = hash;
                            }
                        </script>
                        <form method="post" action="/api/authorize">
                            <input id="salt" type="hidden" name="salt" value="${randomInt(100000000)}">
                            <input id="password" type="password" name="password" placeholder="Enter password">
                            <input type="submit" value="Submit" onclick="onSubmit(this)">
                        </form>
                    </body>
                </html>`,
        headers: {
            'Content-Type': 'text/html'
        }
    };
}

app.http('authorizePost', {
    methods: ['POST'],
    route: 'authorize',
    authLevel: 'anonymous',
    handler: authorize
});

app.http('authorizeGet', {
    methods: ['GET'],
    route: 'authorize',
    authLevel: 'anonymous',
    handler: renderLoginPage
});
