FROM node:10
ENV NODE_ENV=production
WORKDIR /app
COPY package.json tsconfig.json yarn.lock ./
COPY src ./src
RUN yarn install --frozen-lockfile
CMD [ "yarn", "start" ]
