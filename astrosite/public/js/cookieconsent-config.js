import 'https://cdn.jsdelivr.net/gh/orestbida/cookieconsent@3.0.1/dist/cookieconsent.umd.js';

CookieConsent.run({
    guiOptions: {
        consentModal: {
            layout: "bar",
            position: "bottom",
            equalWeightButtons: false,
            flipButtons: false
        },
        preferencesModal: {
            layout: "box",
            position: "right",
            equalWeightButtons: true,
            flipButtons: false
        }
    },
    categories: {
        necessary: {
            readOnly: true
        },
        analytics: {}
    },
    language: {
        default: "en",
        autoDetect: "browser",
        translations: {
            en: {
                consentModal: {
                    title: "Hector want a cookie",
                    description: "We use cookies for analytics purposes in order to improve your experience on the website and to make Hector events even better going forward. If you dig that, click \"Accept All\". If you suck at golf, click \"Reject All\" or \"Manage preferences\" and be like that.",
                    acceptAllBtn: "Accept all",
                    acceptNecessaryBtn: "Reject all",
                    showPreferencesBtn: "Manage preferences",
                    footer: "<a href=\"#link\">Privacy Policy</a>\n<a href=\"#link\">Terms and conditions</a>"
                },
                preferencesModal: {
                    title: "Consent Preferences Center",
                    acceptAllBtn: "Accept all",
                    acceptNecessaryBtn: "Reject all",
                    savePreferencesBtn: "Save preferences",
                    closeIconLabel: "Close modal",
                    serviceCounterLabel: "Service|Services",
                    sections: [
                        {
                            title: "Cookie Usage",
                            description: "We use cookies for analytics purposes in order to improve your experience on the website and to make Hector events even better going forward. If you dig that, click \"Accept All\". If you suck at golf, click \"Reject All\" and be like that.",
                        },
                        {
                            title: "Strictly Necessary Cookies <span class=\"pm__badge\">Always Enabled</span>",
                            description: "If we had any strictly necessary cookies, they would be listed here. But we don't. So, there's nothing to see here. Move along.",
                            linkedCategory: "necessary"
                        },
                        {
                            title: "Analytics Cookies",
                            description: "This is the optional part. We'd very much like to know which pages you visit and how you interact with them. This helps us make better events for you. If you're cool with that, toggle this on. If you're not, toggle it off.",
                            linkedCategory: "analytics"
                        },
                        {
                            title: "More information",
                            description: "For any query in relation to my policy on cookies and your choices, please contact Hector organizers."
                        }
                    ]
                }
            }
        }
    }
});