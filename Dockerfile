FROM node:10
ENV NODE_ENV=production
WORKDIR /app
COPY package.json tsconfig.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY src ./src
CMD [ "yarn", "start" ]
