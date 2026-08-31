var builder = DistributedApplication.CreateBuilder(args);

builder.AddNpmApp("web", "../web", "dev")
    .WithHttpEndpoint(env: "PORT")
    .WithExternalHttpEndpoints();

builder.Build().Run();
