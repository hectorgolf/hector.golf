import { Response } from 'fetch-h2'

export function describeResponse(response: Response): string {
    const lines: string[] = [];
    lines.push(describeResponseStatus(response));
    lines.push(...describeResponseHeaders(response));
    return lines.join('\n');
}

export function describeResponseStatus(response: Response): string {
    const statusText = response.statusText?.trim() ?? '';
    const suffix = statusText !== response.status.toString() ? ` ${statusText}` : '';
    return `HTTP ${response.status}${suffix}`;
}

export function describeResponseHeaders(response: Response): string[] {
    const lines: string[] = [];
    for (const [key, value] of response.headers.entries()) {
        lines.push(`${key}: ${value}`)
    }
    return lines.sort();
}

export async function describeResponseBody(response: Response): Promise<string> {
    if (response.headers.get('content-type')?.startsWith('application/json')) {
        return await response.json()
            .then(json => JSON.stringify(json, null, 4))
            .catch(() => '(response body not available)');
    }
    return await response.text().catch(() => '(response body not available)')
}
