// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

import { TransferFormat } from "../src/ITransport";

import { HttpClient, HttpRequest } from "../src/HttpClient";
import { ILogger } from "../src/ILogger";
import { ServerSentEventsTransport } from "../src/ServerSentEventsTransport";
import { VerifyLogger } from "./Common";
import { TestEventSource, TestMessageEvent } from "./TestEventSource";
import { TestHttpClient } from "./TestHttpClient";
import { PromiseSource } from "./Utils";

describe("ServerSentEventsTransport", () => {
    it("does not allow non-text formats", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = new ServerSentEventsTransport(new TestHttpClient(), undefined, logger, true, TestEventSource);

            await expect(sse.connect("", TransferFormat.Binary))
                .rejects
                .toMatchObject({ message: "The Server-Sent Events transport only supports the 'Text' transfer format" });
        });
    });

    it("connect waits for EventSource to be connected", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = new ServerSentEventsTransport(new TestHttpClient(), undefined, logger, true, TestEventSource);

            let connectPromise = sse.connect("http://example.com", TransferFormat.Text);
            await TestEventSource.eventSource.openSet;

            let done: boolean = false;
            connectPromise = connectPromise.then(() => {
                done = true;
            });
            expect(done).toEqual(false);

            TestEventSource.eventSource.onopen(new TestMessageEvent());

            await connectPromise;
            expect(done).toEqual(true);
        });
    });

    it("appends access_token to url", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = await createAndStartSSE(logger, "http://example.com", () => "secretToken");

            expect(TestEventSource.eventSource.url).toEqual("http://example.com?access_token=secretToken");
        });
    });

    it("appends access_token to existing query string", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = await createAndStartSSE(logger, "http://example.com?value=null", () => "secretToken");

            expect(TestEventSource.eventSource.url).toEqual("http://example.com?value=null&access_token=secretToken");
        });
    });

    it("sets Authorization header on sends", async () => {
        await VerifyLogger.run(async (logger) => {
            let request: HttpRequest;
            const httpClient = new TestHttpClient().on((r) => {
                request = r;
                return "";
            });

            const sse = await createAndStartSSE(logger, "http://example.com", () => "secretToken", httpClient);

            await sse.send("");

            expect(request!.headers!.Authorization).toEqual("Bearer secretToken");
            expect(request!.url).toEqual("http://example.com");
        });
    });

    it("can receive data", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = await createAndStartSSE(logger);

            let received: string | ArrayBuffer;
            sse.onreceive = (data) => {
                received = data;
            };

            const message = new TestMessageEvent();
            message.data = "receive data";
            TestEventSource.eventSource.onmessage(message);

            expect(typeof received!).toEqual("string");
            expect(received!).toEqual("receive data");
        });
    });

    it("stop closes EventSource and calls onclose", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = await createAndStartSSE(logger);

            let closeCalled: boolean = false;
            sse.onclose = () => {
                closeCalled = true;
            };

            await sse.stop();

            expect(closeCalled).toEqual(true);
            expect(TestEventSource.eventSource.closed).toEqual(true);
        });
    });

    it("can close from EventSource error", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = await createAndStartSSE(logger);

            let closeCalled: boolean = false;
            let error: Error | undefined;
            sse.onclose = (e) => {
                closeCalled = true;
                error = e;
            };

            const errorEvent = new TestMessageEvent();
            errorEvent.data = "error";
            TestEventSource.eventSource.onerror(errorEvent);

            expect(closeCalled).toEqual(true);
            expect(TestEventSource.eventSource.closed).toEqual(true);
            expect(error).toMatchObject({ message: "error" });
        });
    });

    it("send throws if not connected", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = new ServerSentEventsTransport(new TestHttpClient(), undefined, logger, true, TestEventSource);

            await expect(sse.send(""))
                .rejects
                .toMatchObject({ message: "Cannot send until the transport is connected" });
        });
    });

    it("closes on error from receive", async () => {
        await VerifyLogger.run(async (logger) => {
            const sse = await createAndStartSSE(logger);

            sse.onreceive = () => {
                throw new Error("error parsing");
            };

            let closeCalled: boolean = false;
            let error: Error | undefined;
            sse.onclose = (e) => {
                closeCalled = true;
                error = e;
            };

            const errorEvent = new TestMessageEvent();
            errorEvent.data = "some data";
            TestEventSource.eventSource.onmessage(errorEvent);

            expect(closeCalled).toEqual(true);
            expect(TestEventSource.eventSource.closed).toEqual(true);
            expect(error).toMatchObject({ message: "error parsing" });
        });
    });
});

async function createAndStartSSE(logger: ILogger, url?: string, accessTokenFactory?: (() => string | Promise<string>), httpClient?: HttpClient): Promise<ServerSentEventsTransport> {
    const sse = new ServerSentEventsTransport(httpClient || new TestHttpClient(), accessTokenFactory, logger, true, TestEventSource);

    const connectPromise = sse.connect(url || "http://example.com", TransferFormat.Text);
    await TestEventSource.eventSource.openSet;

    TestEventSource.eventSource.onopen(new TestMessageEvent());
    await connectPromise;
    return sse;
}
