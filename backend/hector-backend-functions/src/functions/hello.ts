import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { getAccessToken } from '../utils/request-processing';


export async function sayHello(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const token = await getAccessToken(request, context)
    if (!token) {
        return {
            status: 403,
            body: `You're not logged in. You should go to ${request.url.replace(/\/api\/.*$/, '/api/authorize')}`,
        };
    } else {
        return {
            status: 200,
            body: `Hello! I see that you've already logged in.`,
        };
    }
};

app.http('sayHello', {
    methods: ['GET', 'POST'],
    route: 'hi',
    authLevel: 'anonymous',
    handler: sayHello
});
