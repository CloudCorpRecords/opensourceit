FROM node:20-alpine
LABEL io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/opensourceit"
WORKDIR /app
COPY package.json server.json ./
COPY bin ./bin
COPY src ./src
COPY server.js ./
COPY public ./public
COPY data ./data
COPY CHARTER.md AGENT-SUBMIT.md README.md LICENSE ./
EXPOSE 4173
# Default: web community. For MCP stdio: docker run -i --rm <image> node bin/opensourceit.js mcp
CMD ["node", "server.js"]
