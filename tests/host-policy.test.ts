import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('dns/promises', () => ({
    lookup: vi.fn()
}));

const { lookup } = await import('dns/promises');
const { assertAllowedTarget, HostPolicyError } = await import('../src/utils/host-policy.js');

const mockedLookup = vi.mocked(lookup);

function stubResolve(address: string, family: 4 | 6 = 4) {
    mockedLookup.mockResolvedValue([{ address, family }] as unknown as Awaited<ReturnType<typeof lookup>>);
}

function stubReject(error: Error) {
    mockedLookup.mockRejectedValue(error);
}

describe('assertAllowedTarget', () => {
    beforeEach(() => {
        mockedLookup.mockReset();
    });

    describe('format validation', () => {
        it('rejects invalid hostname format (whitespace)', async () => {
            await expect(assertAllowedTarget('bad host name', 25575)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it('rejects invalid hostname format (special chars)', async () => {
            await expect(assertAllowedTarget('host!name', 25575)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it('rejects port 0', async () => {
            await expect(assertAllowedTarget('mc.example.com', 0)).rejects.toThrow(/端口/);
        });

        it('rejects negative port', async () => {
            await expect(assertAllowedTarget('mc.example.com', -1)).rejects.toThrow();
        });

        it('rejects port > 65535', async () => {
            await expect(assertAllowedTarget('mc.example.com', 70000)).rejects.toThrow();
        });

        it('rejects NaN port', async () => {
            await expect(assertAllowedTarget('mc.example.com', NaN)).rejects.toThrow();
        });

        it('rejects non-integer port', async () => {
            await expect(assertAllowedTarget('mc.example.com', 1.5)).rejects.toThrow();
        });
    });

    describe('literal IPv4 blocklist', () => {
        it.each([
            ['169.254.169.254', 'AWS/GCP metadata'],
            ['169.254.0.1', 'link-local range'],
            ['169.254.255.255', 'link-local edge'],
            ['168.63.129.16', 'Azure WireServer'],
            ['100.100.100.200', 'Alibaba Cloud'],
            ['192.0.0.192', 'Oracle Cloud']
        ])('blocks %s (%s)', async (ip) => {
            await expect(assertAllowedTarget(ip, 80)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it.each([
            ['127.0.0.1', 'loopback'],
            ['10.0.0.5', 'RFC1918 /8'],
            ['172.16.0.1', 'RFC1918 /12'],
            ['192.168.1.1', 'RFC1918 /16'],
            ['8.8.8.8', 'public DNS'],
            ['169.253.255.255', 'just below link-local'],
            ['169.255.0.0', 'just above link-local'],
            ['168.63.129.17', 'adjacent to Azure WireServer']
        ])('allows %s (%s)', async (ip) => {
            await expect(assertAllowedTarget(ip, 25575)).resolves.toBeUndefined();
        });
    });

    describe('hostname blocklist', () => {
        it.each([
            'metadata.google.internal',
            'metadata',
            'metadata.goog',
            'metadata.azure.com'
        ])('blocks %s exactly', async (host) => {
            await expect(assertAllowedTarget(host, 80)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it('blocks hostname case-insensitively', async () => {
            await expect(assertAllowedTarget('Metadata.Google.Internal', 80)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it('does not block an unrelated hostname that contains "metadata" as substring', async () => {
            stubResolve('8.8.8.8');
            await expect(assertAllowedTarget('my-metadata-server.example.com', 25575)).resolves.toBeUndefined();
        });
    });

    describe('DNS resolution check', () => {
        it('blocks hostname that resolves to a blocked IP', async () => {
            stubResolve('169.254.169.254');
            await expect(assertAllowedTarget('sneaky.example.com', 25575)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it('blocks if ANY resolved address is blocked', async () => {
            mockedLookup.mockResolvedValue([
                { address: '8.8.8.8', family: 4 },
                { address: '169.254.169.254', family: 4 }
            ] as unknown as Awaited<ReturnType<typeof lookup>>);
            await expect(assertAllowedTarget('multi.example.com', 25575)).rejects.toBeInstanceOf(HostPolicyError);
        });

        it('allows hostname resolving to public IP', async () => {
            stubResolve('8.8.8.8');
            await expect(assertAllowedTarget('mc.example.com', 25575)).resolves.toBeUndefined();
        });

        it('allows hostname resolving to private IP (docker container)', async () => {
            stubResolve('172.18.0.3');
            await expect(assertAllowedTarget('mc', 25575)).resolves.toBeUndefined();
        });

        it('converts DNS lookup failure into HostPolicyError', async () => {
            stubReject(new Error('ENOTFOUND'));
            await expect(assertAllowedTarget('does-not-exist.example.com', 25575)).rejects.toThrow(/解析/);
        });

        it('skips DNS lookup for literal IPv4 addresses', async () => {
            await assertAllowedTarget('8.8.8.8', 25575);
            expect(mockedLookup).not.toHaveBeenCalled();
        });

        it('runs DNS lookup for non-literal hostnames', async () => {
            stubResolve('8.8.8.8');
            await assertAllowedTarget('mc.example.com', 25575);
            expect(mockedLookup).toHaveBeenCalledOnce();
        });
    });

    describe('HostPolicyError', () => {
        it('is distinguishable from generic Error', async () => {
            try {
                await assertAllowedTarget('169.254.169.254', 80);
                expect.fail('should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(HostPolicyError);
                expect((error as Error).name).toBe('HostPolicyError');
            }
        });
    });
});
