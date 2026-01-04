import * as vscode from 'vscode';

export class PurchaseFlow {
    private panel: vscode.WebviewPanel | undefined;

    constructor(private context: vscode.ExtensionContext) {}

    async showPurchaseOptions() {
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'anyragPurchase',
            'Upgrade to AnyRAG Pro',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getWebviewContent();

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'openPayPal':
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                        break;
                    case 'close':
                        this.panel?.dispose();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Upgrade to AnyRAG Pro</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            color: var(--vscode-textLink-foreground);
            margin-bottom: 10px;
        }
        .tagline {
            font-size: 18px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 40px;
        }
        .pricing-container {
            display: flex;
            gap: 30px;
            margin: 40px 0;
        }
        .pricing-card {
            flex: 1;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 30px;
            background-color: var(--vscode-editor-background);
        }
        .pricing-card.recommended {
            border-color: var(--vscode-textLink-foreground);
            border-width: 2px;
            position: relative;
        }
        .recommended-badge {
            position: absolute;
            top: -12px;
            right: 20px;
            background-color: var(--vscode-textLink-foreground);
            color: var(--vscode-editor-background);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
        }
        .plan-name {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .price {
            font-size: 36px;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
            margin: 20px 0;
        }
        .price-period {
            font-size: 16px;
            color: var(--vscode-descriptionForeground);
        }
        .features {
            list-style: none;
            padding: 0;
            margin: 30px 0;
        }
        .features li {
            padding: 10px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .features li:before {
            content: "✓ ";
            color: var(--vscode-textLink-foreground);
            font-weight: bold;
            margin-right: 10px;
        }
        .cta-button {
            width: 100%;
            padding: 15px;
            font-size: 16px;
            font-weight: bold;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            transition: background-color 0.2s;
        }
        .cta-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .cta-button.secondary {
            background-color: transparent;
            border: 1px solid var(--vscode-button-border);
        }
        .info-section {
            margin-top: 50px;
            padding-top: 30px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .info-section h3 {
            margin-top: 30px;
            color: var(--vscode-textLink-foreground);
        }
        .paypal-info {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <h1>🚀 Upgrade to AnyRAG Pro</h1>
    <p class="tagline">Unlock advanced RAG features for professional development</p>

    <div class="pricing-container">
        <div class="pricing-card">
            <div class="plan-name">Pro Monthly</div>
            <div class="price">
                $20
                <span class="price-period">/month</span>
            </div>
            <ul class="features">
                <li>Unlimited indexing</li>
                <li>Advanced search algorithms</li>
                <li>Priority support</li>
                <li>Cancel anytime</li>
            </ul>
            <button class="cta-button" onclick="purchaseMonthly()">Subscribe Monthly</button>
        </div>

        <div class="pricing-card recommended">
            <div class="recommended-badge">BEST VALUE</div>
            <div class="plan-name">Pro Yearly</div>
            <div class="price">
                $200
                <span class="price-period">/year</span>
            </div>
            <ul class="features">
                <li>All Pro features</li>
                <li>Save $40/year (2 months free)</li>
                <li>Priority support</li>
                <li>Cancel anytime</li>
            </ul>
            <button class="cta-button" onclick="purchaseYearly()">Subscribe Yearly</button>
        </div>
    </div>

    <div class="info-section">
        <h3>How it works</h3>
        <div class="paypal-info">
            <p><strong>1.</strong> Click a subscription button above to open PayPal in your browser</p>
            <p><strong>2.</strong> Complete the secure PayPal checkout</p>
            <p><strong>3.</strong> Your license key will be emailed to you within minutes</p>
            <p><strong>4.</strong> Activate your license using the "Activate License" command</p>
        </div>

        <h3>Frequently Asked Questions</h3>
        <p><strong>Can I cancel anytime?</strong><br>
        Yes! Cancel your subscription through PayPal at any time. Your license remains valid until the end of your billing period.</p>

        <p><strong>What payment methods do you accept?</strong><br>
        We accept all major credit cards, debit cards, and PayPal balance through our secure PayPal integration.</p>

        <p><strong>Is this a recurring subscription?</strong><br>
        Yes, subscriptions renew automatically. You can cancel at any time from your PayPal account.</p>

        <p><strong>Do you offer refunds?</strong><br>
        Yes! We offer a 30-day money-back guarantee. Contact support@anyrag.dev if you're not satisfied.</p>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function purchaseMonthly() {
            const paypalUrl = 'https://www.sandbox.paypal.com/webapps/billing/plans/subscribe?plan_id=P-8LC165993X096142HNFJXPVA';
            vscode.postMessage({
                command: 'openPayPal',
                url: paypalUrl
            });
        }

        function purchaseYearly() {
            // Using same test URL for now - replace with yearly plan ID when available
            const paypalUrl = 'https://www.sandbox.paypal.com/webapps/billing/plans/subscribe?plan_id=P-8LC165993X096142HNFJXPVA';
            vscode.postMessage({
                command: 'openPayPal',
                url: paypalUrl
            });
        }
    </script>
</body>
</html>`;
    }
}
