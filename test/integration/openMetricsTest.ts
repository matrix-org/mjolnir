import { strict as assert } from "assert";
import { getRequestFn } from "matrix-bot-sdk";

import { IConfig } from "../../src/config";

async function fetchMetrics(config: IConfig): Promise<string> {
    if (!config.health.openMetrics?.enabled) {
        throw new TypeError("openMetrics deactivated, cannot fetch");
    }
    let uri = new URL("http://localhost");
    uri.port = `${config.health.openMetrics!.port}`;
    uri.pathname = config.health.openMetrics!.endpoint;
    return await new Promise((resolve, reject) =>
        getRequestFn()({
            method: "GET",
            uri
        }, (error: object, _response: any, body: string) => {
            if (error) {
                reject(error);
            } else {
                resolve(body);
            }
        })
    );
}

describe("Test that we can read metrics using the API", function() {
    it('can fetch default metrics', async function() {
        console.debug("config", this.mjolnir.config);
        let metrics = await fetchMetrics(this.mjolnir.config);
        console.debug("Got metrics", metrics);

        // Sample of Prometheus-recommended metrics.
        for (let name of ["process_cpu_seconds_total"]) {
            assert(metrics.includes(name), `Metrics should contain default metric \`${name}\``);
        }

        // Sample of metrics that we're injecting.
        for (let name of ["mjolnir_performance_http_request_sum", "mjolnir_status_api_request_pass", "mjolnir_status_api_request_fail"]) {
            assert(metrics.includes(name), `Metrics should contain custom metric \`${name}\``);
        }
    })
});