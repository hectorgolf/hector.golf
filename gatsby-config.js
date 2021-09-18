module.exports = {
  siteMetadata: {
    siteUrl: "https://www.yourdomain.tld",
    title: "Hector Golf",
  },
  plugins: [
    {
      resolve: "gatsby-plugin-google-analytics",
      options: {
        trackingId: "G-T6VBH6ZV8T",
      },
    },
    "gatsby-plugin-react-helmet",
  ],
};
