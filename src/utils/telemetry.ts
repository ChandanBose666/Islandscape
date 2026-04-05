import * as vscode from 'vscode';
import { TelemetryReporter } from '@vscode/extension-telemetry';

// Replace with your actual Application Insights connection string before publishing.
// This value is safe to commit — it is scoped to event ingestion only, not data reads.
const CONNECTION_STRING = 'InstrumentationKey=00000000-0000-0000-0000-000000000000';

let reporter: TelemetryReporter | null = null;

/**
 * Initialise telemetry. Called once from activate().
 * Telemetry is opt-in — VSCode's global telemetry setting is respected
 * automatically by TelemetryReporter; we never send data when the user has
 * disabled telemetry in VSCode preferences.
 */
export function initTelemetry(context: vscode.ExtensionContext): void {
  reporter = new TelemetryReporter(CONNECTION_STRING);
  context.subscriptions.push(reporter);
}

/**
 * Send an anonymous event. Safe to call even before initTelemetry() or after
 * the reporter is disposed — both cases are no-ops.
 *
 * @param eventName  Short snake_case name, e.g. 'analyze_file'
 * @param properties Optional string key→value pairs (no PII)
 * @param measurements Optional numeric key→value pairs
 */
export function sendEvent(
  eventName: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>,
): void {
  reporter?.sendTelemetryEvent(eventName, properties, measurements);
}
